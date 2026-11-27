import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// 27.11.2026 (Ariel, https://claude.ai/artifact/5GT2bZeiXvbMCfCYBoe4Pg):
// access by mailbox, through the connector.
// - A client's mailbox: the system admins, the account manager and the
//   backup manager by role; anyone else only from the mailbox's list, read
//   only or read and send. Seeing the client is no longer enough.
// - An employee's own mailbox: only its owner, not an admin, and never an
//   email with a sender marked "לא לקרוא".
// - A mailbox can be named by its address alone; list_my_mailboxes lists
//   them all.
// - The list is edited by the admins, the account manager and the backup
//   manager, and only with people who see the client.
// Unipile is stubbed.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { accessLossReport, changeMailboxAccess, grantMailboxAccess, mailboxAccessViews } from "@/lib/client-mailbox/access";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: unknown) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text, isError: !!result.isError };
  } catch {
    return { json: null, text, isError: !!result.isError };
  }
}

function email(id: string, from: string, subject: string) {
  return {
    id,
    thread_id: `th_${id}`,
    date: "2026-11-20T08:15:00.000Z",
    subject,
    snippet: subject,
    body_plain: `גוף: ${subject}`,
    from: [{ email: from }],
    to: [{ email: "anna@ankora.co.il" }],
    cc: [],
    attachments: [],
    folders: ["INBOX"],
  };
}

const WORK = email("em_work", "nadav@grantor.co.il", "דוח רבעוני");
const BANK = email("em_bank", "alerts@bank.co.il", "יתרה בחשבון");
let seen: string[] = [];

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  seen = [];
  process.env.UNIPILE_API_KEY = "test-key";
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v2/, "");
    const method = init?.method ?? "GET";
    seen.push(`${method} ${path}`);
    const acc = path.match(/^\/accounts\/(acc_[\w-]+)$/);
    if (acc) return reply(200, { object: "Account", id: acc[1], provider: "GOOGLE", status: "running", name: "x", created_at: "2026-11-01T00:00:00.000Z" });
    const box = path.match(/^\/(acc_\w+)\/(.*)$/);
    if (!box) return reply(404, {});
    const [, , rest] = box;
    if (rest === "emails" && method === "GET") return reply(200, { data: [WORK, BANK] });
    if (rest === "emails/em_work") return reply(200, WORK);
    if (rest === "emails/em_bank") return reply(200, BANK);
    if (rest === "threads/th_em_bank") return reply(200, { object: "Thread", id: "th_em_bank", emails: [BANK] });
    if (rest === "drafts" && method === "POST") return reply(200, { object: "Draft", id: "dr_1", subject: "x" });
    if (rest === "email-senders") return reply(200, { data: [] });
    return reply(404, {});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function world() {
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: manager } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: backup } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: outsider } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const grantor = await createTestClient({ name: "גרנטור" });
  await prisma.client.update({ where: { id: grantor.id }, data: { accountManagerId: manager.id, backupManagerId: backup.id } });
  for (const u of [manager, backup, anna, hadas]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: grantor.id } });
  const nadav = await prisma.clientConnection.create({
    data: { clientId: grantor.id, kind: "UNIPILE_MAIL", account: "nadav@grantor.co.il", scopes: ["mail", "calendar"], unipileAccountId: "acc_nadav", connectedById: manager.id },
  });
  return { admin, manager, backup, anna, hadas, outsider, grantor, nadav };
}

describe("a client mailbox by role and by list", () => {
  it("is open to the admins, the account manager and the backup manager, and closed to others who see the client", async () => {
    const { admin, manager, backup, anna } = await world();
    for (const u of [admin, manager, backup]) {
      const r = await call(u, "search_client_emails", { client: "גרנטור" });
      expect(r.isError).toBe(false);
      expect(r.json.mailbox).toBe("nadav@grantor.co.il");
    }
    const before = seen.length;
    const refused = await call(anna, "search_client_emails", { client: "גרנטור" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("אין לך גישה לתיבה nadav@grantor.co.il");
    expect(refused.text).toContain("מסך החיבורים");
    expect(seen.length).toBe(before);

    const status = await call(anna, "get_client_mailbox", { client: "גרנטור" });
    expect(status.json.mailboxes).toEqual([expect.objectContaining({ mailbox: "nadav@grantor.co.il", yourAccess: "none" })]);
  });

  it("reads only, or reads and sends, as the list says", async () => {
    const { manager, anna, nadav } = await world();
    const access = await grantMailboxAccess(manager, { connectionId: nadav.id, userId: anna.id, canSend: false });
    const read = await call(anna, "search_client_emails", { client: "גרנטור" });
    expect(read.isError).toBe(false);
    const draft = await call(anna, "save_client_email_draft", { client: "גרנטור", to: ["x@y.co"], text: "שלום" });
    expect(draft.isError).toBe(true);
    expect(draft.text).toContain("קריאה בלבד");

    await changeMailboxAccess(manager, { accessId: access.id, canSend: true });
    const ok = await call(anna, "save_client_email_draft", { client: "גרנטור", to: ["x@y.co"], text: "שלום" });
    expect(ok.isError).toBe(false);
    expect(ok.json.draftId).toBe("dr_1");

    await changeMailboxAccess(manager, { accessId: access.id, remove: true });
    expect((await call(anna, "search_client_emails", { client: "גרנטור" })).text).toContain("אין לך גישה");
    const actions = (await prisma.auditEvent.findMany({ where: { entityId: nadav.id, action: { startsWith: "connection.mailbox_access" } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["connection.mailbox_access_grant", "connection.mailbox_access_change", "connection.mailbox_access_revoke"]);
  });

  it("moves with the account manager role", async () => {
    const { manager, anna, grantor } = await world();
    await prisma.client.update({ where: { id: grantor.id }, data: { accountManagerId: anna.id } });
    expect((await call(anna, "search_client_emails", { client: "גרנטור" })).isError).toBe(false);
    expect((await call(manager, "search_client_emails", { client: "גרנטור" })).text).toContain("אין לך גישה");
  });

  it("finds a mailbox by its address alone, and still checks the person", async () => {
    const { manager, outsider, anna } = await world();
    const r = await call(manager, "search_client_emails", { mailbox: "Nadav@Grantor.co.il" });
    expect(r.isError).toBe(false);
    expect(r.json.client).toBeUndefined();
    expect(r.json.mailbox).toBe("nadav@grantor.co.il");
    expect((await call(outsider, "get_client_email", { mailbox: "nadav@grantor.co.il", emailId: "em_work" })).text).toContain("אין לך גישה");
    expect((await call(anna, "get_client_email", { mailbox: "nadav@grantor.co.il", emailId: "em_work" })).text).toContain("אין לך גישה");
    const unknown = await call(manager, "search_client_emails", { mailbox: "nobody@x.co" });
    expect(unknown.text).toContain("list_my_mailboxes");
    const neither = await call(manager, "search_client_emails", {});
    expect(neither.text).toContain("כתובת התיבה");
  });

  it("is edited only by the three roles, and only with people who see the client", async () => {
    const { manager, backup, admin, anna, hadas, outsider, nadav } = await world();
    await expect(grantMailboxAccess(anna, { connectionId: nadav.id, userId: hadas.id, canSend: true })).rejects.toThrow("מנהלי המערכת");
    await expect(grantMailboxAccess(manager, { connectionId: nadav.id, userId: outsider.id, canSend: true })).rejects.toThrow("גישה ללקוח");
    await grantMailboxAccess(backup, { connectionId: nadav.id, userId: hadas.id, canSend: true });
    await grantMailboxAccess(admin, { connectionId: nadav.id, userId: anna.id, canSend: false });

    const views = await mailboxAccessViews(nadav.clientId);
    expect(views[nadav.id].list.map((l) => [l.userId, l.canSend])).toEqual([
      [hadas.id, true],
      [anna.id, false],
    ]);
    expect(views[nadav.id].byRole.map((r) => r.reason)).toEqual(["accountManager", "backupManager"]);
    expect(views[nadav.id].candidates).toEqual([]);
  });

  it("reports who loses access when the rule starts", async () => {
    const { manager, anna, hadas, nadav } = await world();
    await grantMailboxAccess(manager, { connectionId: nadav.id, userId: hadas.id, canSend: true });
    const row = (await accessLossReport()).find((r) => r.mailbox === "nadav@grantor.co.il")!;
    expect(row.onList).toEqual([hadas.name]);
    expect(row.loses).toEqual([anna.name]);
    expect(row.keepByRole).toHaveLength(2);
  });
});

describe("an employee's own mailbox through the connector", () => {
  async function own(owner: User) {
    const channel = await prisma.mailChannel.create({ data: { accountId: "acc_anna", address: "anna@ankora.co.il", ownerUserId: owner.id, kindChosenAt: new Date() } });
    await prisma.mailBlock.create({ data: { channelId: channel.id, kind: "DOMAIN", value: "bank.co.il", status: "APPROVED", requestedById: owner.id } });
    return channel;
  }

  it("is read by its owner without the senders marked do-not-read, and by no one else", async () => {
    const { anna, admin } = await world();
    const channel = await own(anna);

    const found = await call(anna, "search_client_emails", { mailbox: "anna@ankora.co.il" });
    expect(found.isError).toBe(false);
    expect(found.json.emails.map((e: { id: string }) => e.id)).toEqual(["em_work"]);
    expect(found.json.hiddenPersonal).toBe(1);
    expect(JSON.stringify(found.json)).not.toContain("יתרה");

    const bank = await call(anna, "get_client_email", { mailbox: "anna@ankora.co.il", emailId: "em_bank" });
    expect(bank.isError).toBe(true);
    expect(bank.text).toContain("לא לקרוא");
    const thread = await call(anna, "get_client_email", { mailbox: "anna@ankora.co.il", threadId: "th_em_bank" });
    expect(thread.text).toContain("לא לקרוא");
    const forward = await call(anna, "save_client_email_draft", { mailbox: "anna@ankora.co.il", forwardEmailId: "em_bank", to: ["x@y.co"], text: "fyi" });
    expect(forward.text).toContain("לא לקרוא");

    const work = await call(anna, "get_client_email", { mailbox: "anna@ankora.co.il", emailId: "em_work" });
    expect(work.json.emails[0].subject).toBe("דוח רבעוני");

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "MailChannel", entityId: channel.id, action: "connection.mail_read" } });
    expect((audit.afterJson as { access: string }).access).toBe("owner");

    const notAdmin = await call(admin, "search_client_emails", { mailbox: "anna@ankora.co.il" });
    expect(notAdmin.isError).toBe(true);
    expect(notAdmin.text).toContain("anna@ankora.co.il");
  });

  it("is listed with every client mailbox open to the person", async () => {
    const { anna, manager, nadav, grantor } = await world();
    await own(anna);
    await prisma.mailChannel.create({ data: { accountId: "acc_anna_g", address: "anna@grantor.co.il", ownerUserId: anna.id, clientId: grantor.id, kindChosenAt: new Date() } });
    await grantMailboxAccess(manager, { connectionId: nadav.id, userId: anna.id, canSend: false });

    const mine = await call(anna, "list_my_mailboxes", {});
    expect(mine.json.mailboxes).toEqual([
      { mailbox: "anna@ankora.co.il", kind: "personal", client: null, yourAccess: "read_and_send", accessReason: "owner" },
      { mailbox: "anna@grantor.co.il", kind: "personal", client: "גרנטור", yourAccess: "read_and_send", accessReason: "owner" },
      { mailbox: "nadav@grantor.co.il", kind: "client", client: "גרנטור", yourAccess: "read_only", accessReason: "list" },
    ]);

    // With the client named, the client has two mailboxes open to Anna.
    const which = await call(anna, "search_client_emails", { client: "גרנטור" });
    expect(which.text).toContain("anna@grantor.co.il");
    expect(which.text).toContain("nadav@grantor.co.il");

    const theirs = await call(manager, "list_my_mailboxes", {});
    expect(theirs.json.mailboxes.map((m: { mailbox: string }) => m.mailbox)).toEqual(["nadav@grantor.co.il"]);
  });
});
