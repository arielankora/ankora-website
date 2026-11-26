import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// 26.11.2026 (Ariel and Hadas): a client's mailbox connected through
// Unipile and read through the connector by everyone who sees the client.
// What is worth holding:
// - the way back from Unipile adds a mailbox only with the signed intent of
//   someone allowed to connect, only for a mail account linked after it, and
//   never one another client already has;
// - the tools read the right mailbox, audit every read, and refuse in words
//   (no mailbox, a marked client, a dropped connection, nobody's client);
// - a disconnect removes the account at Unipile.
// Unipile itself is stubbed: the requests Ankora makes are part of what is
// checked.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { completeMailboxConnect, createMailboxConnectLink, readMailboxIntent } from "@/lib/client-mailbox/connect";
import { disconnect } from "@/lib/app-domain/connections";

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

type Seen = { method: string; path: string; query: URLSearchParams; body: unknown };
let seen: Seen[] = [];
let accounts: Record<string, { provider: string; status: string; name: string; created_at: string }> = {};

const EMAIL = {
  id: "em_1",
  thread_id: "th_1",
  date: "2026-11-20T08:15:00.000Z",
  subject: "קורות חיים: רכזת גיוס",
  snippet: "מצורפים",
  body_plain: "שלום, מצורפים קורות החיים שלי. דנה",
  from: [{ email: "dana@example.com", display_name: "Dana Levi" }],
  to: [{ email: "jobs@career.co.il" }],
  cc: [],
  attachments: [{ id: "att_cv", type: "file", filename: "dana-cv.txt", mimetype: "text/plain", file_size: 40, is_inline: false }],
  folders: ["INBOX"],
  is_unread: true,
};

function reply(status: number, body: unknown, type = "application/json"): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
}

beforeEach(() => {
  seen = [];
  accounts = {};
  process.env.UNIPILE_API_KEY = "test-key";
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-mailbox-intent";
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v2/, "");
    const method = init?.method ?? "GET";
    seen.push({ method, path, query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : null });
    expect((init?.headers as Record<string, string>)["X-API-KEY"]).toBe("test-key");
    if (path === "/auth/link") return reply(200, { object: "HostedAuthLink", link: "https://account.unipile.com/link-123" });
    const acc = path.match(/^\/accounts\/(acc_[\w-]+)$/);
    if (acc) {
      if (method === "DELETE") return reply(200, { object: "AccountDeleted" });
      const a = accounts[acc[1]];
      return a ? reply(200, { object: "Account", id: acc[1], user_id: "u", ...a }) : reply(404, {});
    }
    if (path.startsWith("/acc_down/")) return reply(401, {});
    if (path === "/acc_mail/emails") return reply(200, { data: [EMAIL], next_cursor: "c2" });
    if (path === "/acc_mail/emails/em_1") return reply(200, EMAIL);
    if (path === "/acc_mail/threads/th_1") return reply(200, { object: "Thread", id: "th_1", emails: [EMAIL] });
    if (path === "/acc_mail/emails/em_1/attachments/att_cv") return reply(200, "Dana Levi. 5 years recruiting.", "text/plain");
    if (path === "/acc_mail/folders") return reply(200, { data: [{ id: "INBOX", name: "INBOX", role: "inbox", unread_count: 3 }] });
    if (path === "/acc_mail/email-senders") return reply(200, { data: [{ email: "jobs@career.co.il", is_primary: true }] });
    return reply(404, {});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function world() {
  const { user: manager } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: colleague } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const client = await createTestClient({ name: "קריירה ועוד" });
  const other = await createTestClient({ name: "אחר" });
  const marked = await createTestClient({ name: "חסוי" });
  await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: manager.id } });
  await prisma.client.update({ where: { id: marked.id }, data: { aiExcluded: true, accountManagerId: manager.id } });
  for (const c of [client, other, marked]) {
    for (const u of [manager, colleague]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: c.id } });
  }
  return { manager, colleague, stranger, client, other, marked };
}

async function mailbox(clientId: string, by: User, accountId = "acc_mail", account = "jobs@career.co.il") {
  return prisma.clientConnection.create({
    data: { clientId, kind: "UNIPILE_MAIL", account, scopes: ["mail", "calendar"], unipileAccountId: accountId, connectedById: by.id },
  });
}

describe("connecting a client mailbox through Unipile", () => {
  it("adds the mailbox only from a signed intent, for a new mail account no client has", async () => {
    const { manager, colleague, client, other } = await world();
    const redirectUri = "https://app.example/api/connections/mailbox/callback";

    await expect(createMailboxConnectLink(colleague, { clientId: client.id, redirectUri })).rejects.toThrow("מנהל התיק");

    const { link, intent } = await createMailboxConnectLink(manager, { clientId: client.id, redirectUri });
    expect(link).toBe("https://account.unipile.com/link-123");
    const sent = seen.find((s) => s.path === "/auth/link")!.body as { providers: string[]; state: string; redirect_uri: string };
    expect(sent.providers).toEqual(["google", "outlook", "imap"]);
    expect(sent.redirect_uri).toBe(redirectUri);
    expect(sent.state).toBe(intent);

    const now = new Date().toISOString();
    accounts.acc_new = { provider: "GOOGLE", status: "running", name: "Jobs@Career.co.il", created_at: now };
    accounts.acc_wa = { provider: "WHATSAPP", status: "running", name: "972500000000", created_at: now };
    accounts.acc_old = { provider: "GOOGLE", status: "running", name: "old@x.co", created_at: "2026-01-01T00:00:00.000Z" };

    const parsed = readMailboxIntent(intent);
    expect(await completeMailboxConnect(readMailboxIntent(intent + "x"), { accountId: "acc_new", error: null })).toMatchObject({ result: "expired" });
    expect(await completeMailboxConnect(parsed, { accountId: "acc_wa", error: null })).toMatchObject({ result: "wrongProvider" });
    expect(await completeMailboxConnect(parsed, { accountId: "acc_old", error: null })).toMatchObject({ result: "taken" });
    expect(await completeMailboxConnect(parsed, { accountId: null, error: "cancelled" })).toMatchObject({ result: "failed" });

    expect(await completeMailboxConnect(parsed, { accountId: "acc_new", error: null })).toEqual({ result: "connected", clientId: client.id });
    const row = await prisma.clientConnection.findUniqueOrThrow({ where: { unipileAccountId: "acc_new" } });
    expect(row).toMatchObject({ kind: "UNIPILE_MAIL", account: "jobs@career.co.il", scopes: ["mail", "calendar"], connectedById: manager.id, credentialId: null });
    expect(await prisma.auditEvent.count({ where: { action: "connection.add", entityId: row.id } })).toBe(1);

    // The same account cannot be claimed for another client.
    await prisma.client.update({ where: { id: other.id }, data: { accountManagerId: manager.id } });
    const forOther = readMailboxIntent((await createMailboxConnectLink(manager, { clientId: other.id, redirectUri })).intent);
    expect(await completeMailboxConnect(forOther, { accountId: "acc_new", error: null })).toMatchObject({ result: "taken" });
  });

  it("disconnecting removes the account at Unipile and keeps the history", async () => {
    const { manager, client } = await world();
    const row = await mailbox(client.id, manager);
    await disconnect(manager, row.id);
    expect(seen.some((s) => s.method === "DELETE" && s.path === "/accounts/acc_mail")).toBe(true);
    expect((await prisma.clientConnection.findUniqueOrThrow({ where: { id: row.id } })).revokedAt).not.toBeNull();
  });
});

describe("a client mailbox through the connector", () => {
  it("searches, reads a thread and an attachment, and audits each read", async () => {
    const { manager, colleague, client } = await world();
    const row = await mailbox(client.id, manager);
    accounts.acc_mail = { provider: "GOOGLE", status: "running", name: "jobs@career.co.il", created_at: "2026-11-01T00:00:00.000Z" };

    const status = await call(colleague, "get_client_mailbox", { client: "קריירה ועוד" });
    expect(status.json.mailboxes).toEqual([
      expect.objectContaining({ mailbox: "jobs@career.co.il", state: "connected", can: ["mail", "calendar"], sendersAvailable: [{ email: "jobs@career.co.il", name: null, primary: true }] }),
    ]);

    const found = await call(colleague, "search_client_emails", { client: "קריירה ועוד", text: "קורות חיים", hasAttachment: true, after: "2026-11-01", limit: 10 });
    expect(found.isError).toBe(false);
    expect(found.json.emails[0]).toMatchObject({ id: "em_1", from: ["Dana Levi <dana@example.com>"], at: "2026-11-20 10:15", attachments: [{ id: "att_cv", fileName: "dana-cv.txt" }] });
    expect(found.json.nextCursor).toBe("c2");
    const q = seen.find((s) => s.path === "/acc_mail/emails")!.query;
    expect(q.get("q")).toBe("קורות חיים");
    expect(q.get("has_attachment")).toBe("true");
    expect(q.get("after")).toBe("2026-10-31T22:00:00.000Z");
    expect(q.get("limit")).toBe("10");

    const thread = await call(colleague, "get_client_email", { client: "קריירה ועוד", threadId: "th_1" });
    expect(thread.json.emails[0]).toMatchObject({ text: "שלום, מצורפים קורות החיים שלי. דנה", subject: "קורות חיים: רכזת גיוס" });

    const file = await call(colleague, "read_client_email_attachment", { client: "קריירה ועוד", emailId: "em_1", attachmentId: "att_cv" });
    expect(file.json).toMatchObject({ fileName: "dana-cv.txt", text: "Dana Levi. 5 years recruiting.", truncated: false });

    const folders = await call(colleague, "list_client_mail_folders", { client: "קריירה ועוד" });
    expect(folders.json.folders).toEqual([{ id: "INBOX", name: "INBOX", role: "inbox", unread: 3 }]);

    const reads = await prisma.auditEvent.findMany({ where: { action: "connection.mail_read", entityId: row.id }, orderBy: { createdAt: "asc" } });
    expect(reads.map((r) => (r.afterJson as { what: string }).what)).toEqual(["search", "thread", "attachment", "setup"]);
    expect(reads.every((r) => r.actorId === colleague.id)).toBe(true);
    expect(JSON.stringify(reads)).not.toContain("5 years recruiting");
    expect((await prisma.clientConnection.findUniqueOrThrow({ where: { id: row.id } })).lastUsedAt).not.toBeNull();
  });

  it("refuses in words: no mailbox, a marked client, a dropped connection, a client the person does not see", async () => {
    const { manager, stranger, client, other, marked } = await world();
    await mailbox(marked.id, manager, "acc_marked", "x@marked.co");

    const none = await call(manager, "search_client_emails", { client: "אחר" });
    expect(none.isError).toBe(true);
    expect(none.text).toContain("אין תיבת דואר מחוברת");
    expect(none.text).not.toContain("unexpected");

    const hidden = await call(manager, "search_client_emails", { client: "חסוי" });
    expect(hidden.text).toContain("בלי AI");
    expect(seen.some((s) => s.path.startsWith("/acc_marked"))).toBe(false);

    await mailbox(client.id, manager, "acc_down", "down@career.co.il");
    accounts.acc_down = { provider: "GOOGLE", status: "disconnected", name: "down@career.co.il", created_at: "2026-11-01T00:00:00.000Z" };
    const dropped = await call(manager, "search_client_emails", { client: "קריירה ועוד" });
    expect(dropped.isError).toBe(true);
    expect(dropped.text).toContain("נפל");

    const nobody = await call(stranger, "search_client_emails", { client: "קריירה ועוד" });
    expect(nobody.json).toBeNull();
    expect(seen.filter((s) => s.path.startsWith("/acc_down/")).length).toBe(1);
    void other;
  });

  it("asks which mailbox when the client has two", async () => {
    const { manager, client } = await world();
    await mailbox(client.id, manager, "acc_mail", "jobs@career.co.il");
    await mailbox(client.id, manager, "acc_down", "office@career.co.il");
    const which = await call(manager, "search_client_emails", { client: "קריירה ועוד" });
    expect(which.text).toContain("jobs@career.co.il, office@career.co.il");
    const named = await call(manager, "search_client_emails", { client: "קריירה ועוד", mailbox: "JOBS@career.co.il" });
    expect(named.json.mailbox).toBe("jobs@career.co.il");
  });
});
