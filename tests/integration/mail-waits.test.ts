import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// Stage 2 of "התיבות שלי" (27.11.2026, Ariel): a task waits for a reply to an
// email, through the connector as on the screen. What is worth holding:
// - an email the owner sent to anyone is kept 14 days to be picked, who and
//   when only; then dropped unless a task follows it;
// - following marks the task waiting; a reply by anyone but the sender
//   ends the wait, lifts "ממתין" and tells whoever followed and the
//   assignee; the sender writing again does not;
// - a due reminder is sent once; a reminder to the recipient is a reply in
//   the same thread from the same mailbox;
// - only the sender may follow their email or send its reminder;
// - everything the mailbox screens do works through manage_connected_mailbox.
// Unipile is stubbed: the requests Ankora makes are part of what is checked.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { recordMailEvent } from "@/lib/mail-scan/channels";
import { sweepMailWaits } from "@/lib/mail-scan/waits";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
type Validated = { value?: unknown; issues?: readonly { message: string }[] };
type Standard = { "~standard": { validate: (v: unknown) => Validated | Promise<Validated> } };
const tools = new Map<string, { schema?: Standard; handler: Handler }>();
registerAnkoraTools({ registerTool: (name: string, c: { inputSchema?: Standard }, h: Handler) => tools.set(name, { schema: c.inputSchema, handler: h }) } as never);

async function call(user: User, name: string, args: unknown) {
  const tool = tools.get(name)!;
  let parsed = args;
  if (tool.schema && "~standard" in tool.schema) {
    const v = await tool.schema["~standard"].validate(args);
    if (v.issues) throw new Error(v.issues.map((i) => i.message).join("; "));
    parsed = v.value;
  }
  const result = await tool.handler(parsed, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text, isError: !!result.isError };
  } catch {
    return { json: null, text, isError: !!result.isError };
  }
}

type Seen = { method: string; path: string; body: unknown };
let seen: Seen[] = [];
let emails: Record<string, Record<string, unknown>> = {};
let accounts: Record<string, { provider: string; status: string; name: string; created_at: string }> = {};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function email(id: string, thread: string, from: string, to: string[], date: string) {
  emails[id] = { id, thread_id: thread, date, subject: "הצעת מחיר", body_plain: "לא נשמר", from: [{ email: from }], to: to.map((e) => ({ email: e })) };
}

beforeEach(() => {
  seen = [];
  emails = {};
  accounts = {};
  process.env.UNIPILE_API_KEY = "test-key";
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-mail-intent";
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v2/, "");
    const method = init?.method ?? "GET";
    seen.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path === "/auth/link") return reply(200, { link: "https://account.unipile.com/link-mail" });
    if (path.startsWith("/webhooks/endpoints/")) return reply(200, { account_ids: [] });
    const acc = path.match(/^\/accounts\/(acc_[\w-]+)$/);
    if (acc) return accounts[acc[1]] ? reply(200, { object: "Account", id: acc[1], ...accounts[acc[1]] }) : reply(404, {});
    if (/^\/acc_[\w-]+\/emails\/send$/.test(path)) return reply(200, { id: "em_sent" });
    const one = path.match(/^\/(acc_[\w-]+)\/emails\/([\w-]+)$/);
    if (one) return emails[one[2]] ? reply(200, emails[one[2]]) : reply(404, {});
    if (/^\/acc_[\w-]+\/emails$/.test(path)) return reply(200, { data: Object.values(emails) });
    return reply(404, {});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function world() {
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "anna@ankora.co.il" });
  const { user: maor } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "maor@ankora.co.il" });
  const { user: hadas } = await createTestUser({ role: "SUPER_ADMIN", email: "hadas@ankora.co.il" });
  const client = await createTestClient({ name: "Grantor" });
  for (const u of [anna, maor]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await prisma.clientDomain.create({ data: { clientId: client.id, domain: "grantor.co.il", kind: "CLIENT" } });
  const task = await prisma.task.create({ data: { clientId: client.id, title: "קליטת ספק דפוס", assignedToId: maor.id } });
  const step = await prisma.task.create({ data: { clientId: client.id, title: "לבקש הצעת מחיר מהדפוס", parentId: task.id } });
  const box = await prisma.mailChannel.create({
    data: { accountId: "acc_anna", address: "anna@ankora.co.il", ownerUserId: anna.id, kindChosenAt: new Date(), scanEnabled: true, scanStartedAt: new Date() },
  });
  return { anna, maor, hadas, client, task, step, box };
}

describe("emails the owner sent", () => {
  it("are kept 14 days to be picked, who and when only, and dropped after unless followed", async () => {
    const { box } = await world();
    email("e1", "t_print", "anna@ankora.co.il", ["yossi@acme-print.co.il"], "2026-11-27T08:12:00.000Z");
    email("e2", "t_shop", "orders@shop.com", ["anna@ankora.co.il"], "2026-11-27T08:20:00.000Z");
    expect(await recordMailEvent("acc_anna", "e1")).toBe("recorded");
    expect(await recordMailEvent("acc_anna", "e2")).toBe("no-client");
    const t = await prisma.mailThread.findFirstOrThrow({ where: { channelId: box.id } });
    expect(t).toMatchObject({ externalThreadId: "t_print", clientIds: [], lastSentTo: ["yossi@acme-print.co.il"] });
    expect(t.keepUntil!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect(JSON.stringify(t)).not.toContain("הצעת מחיר");

    await prisma.mailThread.update({ where: { id: t.id }, data: { keepUntil: new Date(Date.now() - 1000) } });
    expect((await sweepMailWaits()).dropped).toBe(1);
    expect(await prisma.mailThread.count()).toBe(0);
  });
});

describe("following a reply through the connector", () => {
  it("marks the step waiting, ends the wait on the reply, lifts it and tells both people", async () => {
    const { anna, maor, step } = await world();
    email("e1", "t_print", "anna@ankora.co.il", ["yossi@acme-print.co.il"], "2026-11-27T08:12:00.000Z");
    await recordMailEvent("acc_anna", "e1");

    const sent = await call(anna, "list_sent_emails", {});
    expect(sent.json.emails).toEqual([expect.objectContaining({ to: ["yossi@acme-print.co.il"], mailbox: "anna@ankora.co.il", clients: [] })]);
    expect(sent.json.fieldNotes.emails).toBeTruthy();

    // Someone else cannot follow Anna's email.
    const notMine = await call(maor, "follow_email_reply", { taskId: step.id, to: "yossi@acme-print.co.il", waitingOn: "SUPPLIER" });
    expect(notMine.text).toContain("No email to yossi@acme-print.co.il");

    const followed = await call(anna, "follow_email_reply", { taskId: step.id, to: "Yossi@acme-print.co.il", waitingOn: "SUPPLIER", reason: "הצעת מחיר" });
    expect(followed.isError).toBe(false);
    expect(followed.json.following.to).toEqual(["yossi@acme-print.co.il"]);
    expect(followed.json.following.remindAt).toBeTruthy();
    expect(await prisma.task.findUniqueOrThrow({ where: { id: step.id } })).toMatchObject({ blockedOn: "SUPPLIER", blockedReason: "הצעת מחיר" });
    expect(await prisma.taskMailWait.findFirstOrThrow()).toMatchObject({ via: "CLAUDE", createdById: anna.id });

    const waiting = await call(anna, "get_task", { taskId: step.id });
    expect(waiting.json.waitingOnEmail).toMatchObject({ state: "waiting", to: ["yossi@acme-print.co.il"], followedBy: "you" });
    expect(waiting.json.fieldNotes.waitingOnEmail).toBeTruthy();
    const colleague = await call(maor, "get_task", { taskId: step.id });
    expect(colleague.json.waitingOnEmail.followedBy).toBe("a colleague");
    expect((await call(anna, "list_email_waits", {})).json.waits).toEqual([expect.objectContaining({ state: "waiting", client: "Grantor" })]);

    // Anna writes again in the thread: not the reply, but the next reminder answers it.
    email("e2", "t_print", "anna@ankora.co.il", ["yossi@acme-print.co.il"], "2026-11-27T09:00:00.000Z");
    await recordMailEvent("acc_anna", "e2");
    expect(await prisma.taskMailWait.findFirstOrThrow()).toMatchObject({ endedAt: null, lastEmailId: "e2" });

    email("e3", "t_print", "yossi@acme-print.co.il", ["anna@ankora.co.il"], "2026-11-27T11:05:00.000Z");
    expect(await recordMailEvent("acc_anna", "e3")).toBe("updated");
    expect(await prisma.taskMailWait.findFirstOrThrow()).toMatchObject({ endedHow: "REPLY", replyFrom: "yossi@acme-print.co.il" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: step.id } })).toMatchObject({ blockedOn: null, blockedReason: null });
    expect(await prisma.auditEvent.count({ where: { action: "task.unblocked_by_reply", entityId: step.id } })).toBe(1);
    const told = await prisma.notification.findMany({ where: { type: "mail_wait_reply" }, orderBy: { userId: "asc" } });
    expect(told.map((n) => n.userId).sort()).toEqual([anna.id, maor.id].sort());
    expect(told[0].body).toContain("yossi@acme-print.co.il");

    const replied = await call(anna, "get_task", { taskId: step.id });
    expect(replied.json.waitingOnEmail).toMatchObject({ state: "replied", replyFrom: "yossi@acme-print.co.il" });
    expect((await call(anna, "list_email_waits", {})).json.waits).toEqual([]);
    // The followed thread stays.
    expect((await prisma.mailThread.findFirstOrThrow()).keepUntil).toBeNull();
  });

  it("reminds once when the time passes, and sends a reminder in the same thread", async () => {
    const { anna, task } = await world();
    email("e1", "t_print", "anna@ankora.co.il", ["yossi@acme-print.co.il", "dana@acme-print.co.il"], "2026-11-27T08:12:00.000Z");
    await recordMailEvent("acc_anna", "e1");
    await call(anna, "follow_email_reply", { taskId: task.id, to: "dana@acme-print.co.il", waitingOn: "SUPPLIER", remindAt: "2099-01-01" });
    await prisma.taskMailWait.updateMany({ data: { remindAt: new Date(Date.now() - 60_000) } });

    expect((await sweepMailWaits()).reminded).toBe(1);
    expect((await sweepMailWaits()).reminded).toBe(0);
    expect(await prisma.notification.count({ where: { type: "mail_wait_reminder", userId: anna.id } })).toBe(1);
    expect((await call(anna, "list_email_waits", {})).json.waits[0].state).toBe("overdue");
    expect((await call(anna, "get_task", { taskId: task.id })).json.waitingOnEmail.state).toBe("overdue");

    const missing = await call(anna, "manage_email_wait", { taskId: task.id, action: "send_reminder" });
    expect(missing.text).toContain("Pass `text`");
    const sent = await call(anna, "manage_email_wait", { taskId: task.id, action: "send_reminder", text: "שלום, רציתי לוודא שהמייל הגיע." });
    expect(sent.json).toMatchObject({ sent: true });
    const out = seen.find((s) => s.method === "POST" && s.path === "/acc_anna/emails/send")!.body as Record<string, unknown>;
    expect(out).toMatchObject({ reply_to_provider_id: "e1", subject: "Re: הצעת מחיר", plain_text: "שלום, רציתי לוודא שהמייל הגיע." });
    expect(out.to).toEqual([{ email: "yossi@acme-print.co.il" }, { email: "dana@acme-print.co.il" }]);
    const after = await prisma.taskMailWait.findFirstOrThrow();
    expect(after.remindedAt).toBeNull();
    expect(after.remindAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.auditEvent.count({ where: { action: "task.mail_reminder_sent" } })).toBe(1);
  });

  it("postpone, stop following (still waiting) and not waiting (lifted)", async () => {
    const { anna, maor, task } = await world();
    email("e1", "t_print", "anna@ankora.co.il", ["yossi@acme-print.co.il"], "2026-11-27T08:12:00.000Z");
    await recordMailEvent("acc_anna", "e1");
    await call(anna, "follow_email_reply", { taskId: task.id, to: "yossi@acme-print.co.il", waitingOn: "SUPPLIER" });

    expect((await call(anna, "manage_email_wait", { taskId: task.id, action: "postpone", remindAt: "2001-01-01" })).text).toContain("must be in the future");
    const later = await call(anna, "manage_email_wait", { taskId: task.id, action: "postpone", remindAt: "2099-03-01T10:00" });
    expect(later.json.remindAt).toBe("2099-03-01T08:00:00.000Z");

    // Only the sender sends the reminder.
    const other = await call(maor, "manage_email_wait", { taskId: task.id, action: "send_reminder", text: "x" });
    expect(other.text).toContain("ששלחת");

    await call(anna, "manage_email_wait", { taskId: task.id, action: "stop_following" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ blockedOn: "SUPPLIER" });
    expect((await call(anna, "manage_email_wait", { taskId: task.id, action: "not_waiting" })).text).toContain("לא ממתינה לתשובה");

    await call(anna, "follow_email_reply", { taskId: task.id, to: "yossi@acme-print.co.il", waitingOn: "SUPPLIER", noReminder: true });
    expect((await prisma.taskMailWait.findFirstOrThrow({ where: { endedAt: null } })).remindAt).toBeNull();
    await call(anna, "manage_email_wait", { taskId: task.id, action: "not_waiting" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ blockedOn: null });
  });
});

describe("the mailbox screens through manage_connected_mailbox", () => {
  it("connect link, whose it is, do not read, senders, the switch, and a manager's decisions", async () => {
    const { anna, hadas, box } = await world();
    await prisma.mailChannel.update({ where: { id: box.id }, data: { scanEnabled: false, kindChosenAt: null } });

    const link = await call(anna, "manage_connected_mailbox", { action: "connect_link" });
    expect(link.json).toMatchObject({ link: "https://account.unipile.com/link-mail", validMinutes: 30 });
    const linkBody = seen.find((s) => s.path === "/auth/link")!.body as { state: string; redirect_uri: string };
    expect(linkBody.redirect_uri).toMatch(/\/app\/whatsapp-poc\/mail\/connect\/callback$/);
    expect(linkBody.state).toBeTruthy();

    expect((await call(anna, "manage_connected_mailbox", { action: "set_kind", kind: "CLIENT", client: "Grantor" })).json).toMatchObject({ kind: "CLIENT", client: "Grantor" });
    expect((await call(anna, "manage_connected_mailbox", { action: "do_not_read", value: "not an address" })).text).toContain("`value` must be");
    expect((await call(anna, "manage_connected_mailbox", { action: "do_not_read", value: "@bank.co.il", label: "בנק" })).json).toMatchObject({ value: "bank.co.il", kind: "DOMAIN", status: "PENDING" });
    email("s1", "t1", "service@bank.co.il", ["anna@ankora.co.il"], "2026-11-27T08:00:00.000Z");
    email("s2", "t2", "nadav@grantor.co.il", ["anna@ankora.co.il"], "2026-11-27T08:00:00.000Z");
    const senders = await call(anna, "manage_connected_mailbox", { action: "suggest_senders" });
    expect(senders.json.senders).toEqual(expect.arrayContaining([expect.objectContaining({ address: "service@bank.co.il", blocked: true })]));
    expect((await call(anna, "manage_connected_mailbox", { action: "start_scan" })).json).toMatchObject({ scanning: true });

    // Managers only.
    expect((await call(anna, "manage_connected_mailbox", { action: "decide_do_not_read", value: "bank.co.il", approve: true })).text).toContain("רק מנהל");
    expect((await call(hadas, "manage_connected_mailbox", { action: "decide_do_not_read", mailbox: "anna@ankora.co.il", value: "bank.co.il", approve: true })).json).toMatchObject({ status: "APPROVED" });
    expect((await call(hadas, "manage_connected_mailbox", { action: "revoke_do_not_read", mailbox: "anna@ankora.co.il", value: "bank.co.il" })).json).toMatchObject({ status: "REVOKED" });
    expect((await call(hadas, "manage_connected_mailbox", { action: "set_extraction", mailbox: "anna@ankora.co.il", allowed: false })).json).toMatchObject({ extractionAllowed: false });
    expect((await call(hadas, "manage_connected_mailbox", { action: "change_owner", mailbox: "anna@ankora.co.il", person: "maor@ankora.co.il" })).json.owner).toBeTruthy();

    const listed = await call(hadas, "list_connected_mailboxes", {});
    expect(listed.json.mailboxes[0]).toMatchObject({ kind: "CLIENT", client: "Grantor", state: "unknown", extractionAllowed: false });
    expect(listed.json.mailboxes[0].doNotRead).toEqual([]);
    expect(await prisma.mailChannel.findUniqueOrThrow({ where: { id: box.id } })).toMatchObject({ ownerUserId: expect.not.stringMatching(anna.id) });
  });

  it("says in words when the mailbox is not named and there are several", async () => {
    const { anna } = await world();
    await prisma.mailChannel.create({ data: { accountId: "acc_two", address: "office@grantor.co.il", ownerUserId: anna.id } });
    const r = await call(anna, "manage_connected_mailbox", { action: "start_scan" });
    expect(r.text).toContain("יותר מתיבה אחת");
    expect(r.text).not.toContain("unexpected");
  });
});
