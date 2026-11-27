import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// "התיבות שלי" (27.11.2026, Ariel: "יוניפייל גם לתיבות של אנקורה כמו שיש
// לווצאפ"). What is worth holding:
// - the way back from Unipile connects a mailbox only with this user's
//   signed intent, only for a mail account linked after it; a client's
//   mailbox already connected on the client's screen is not connected twice;
// - whose mailbox it is comes before the switch, and only a client the user
//   works with;
// - of each new email only a thread with a client is recorded, who and when,
//   and never the team writing to itself or a stranger;
// - "לא לקרוא": the owner's request holds, a manager's decision deletes;
// - the connector lists mailboxes, never email, and never names a client
//   marked "בלי AI";
// - a disconnected mailbox tells its owner once a day.
// Unipile is stubbed: the requests Ankora makes are part of what is checked.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import {
  chooseMailboxKind,
  completeMailConnect,
  decideMailBlock,
  recordMailEvent,
  requestMailBlock,
  senderSuggestions,
  setMailExtractionAllowed,
  startScanning,
  type MailConnectIntent,
} from "@/lib/mail-scan/channels";
import { alertMailChannelDisconnected } from "@/lib/mail-scan/disconnect";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: unknown) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  return { json: JSON.parse(text), text, isError: !!result.isError };
}

type Seen = { method: string; path: string; body: unknown };
let seen: Seen[] = [];
let accounts: Record<string, { provider: string; status: string; name: string; created_at: string }> = {};
let emails: Record<string, Record<string, unknown>> = {};
let webhookAccounts: string[] = [];

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function email(id: string, thread: string, from: string, to: string[], date = "2026-11-27T08:00:00.000Z") {
  emails[id] = { id, thread_id: thread, date, subject: "לא נשמר", body_plain: "לא נשמר", from: [{ email: from, display_name: from.split("@")[0] }], to: to.map((e) => ({ email: e })) };
}

beforeEach(() => {
  seen = [];
  accounts = {};
  emails = {};
  webhookAccounts = ["acc_existing"];
  process.env.UNIPILE_API_KEY = "test-key";
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-mail-intent";
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v2/, "");
    const method = init?.method ?? "GET";
    seen.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path === "/auth/link") return reply(200, { link: "https://account.unipile.com/link-mail" });
    if (path.startsWith("/webhooks/endpoints/")) {
      if (method === "PATCH") webhookAccounts = (JSON.parse(String(init!.body)) as { account_ids: string[] }).account_ids;
      return reply(200, { account_ids: webhookAccounts });
    }
    const acc = path.match(/^\/accounts\/(acc_[\w-]+)$/);
    if (acc) {
      if (method === "DELETE") return reply(200, { object: "AccountDeleted" });
      const a = accounts[acc[1]];
      return a ? reply(200, { object: "Account", id: acc[1], ...a }) : reply(404, {});
    }
    const one = path.match(/^\/(acc_[\w-]+)\/emails\/([\w-]+)$/);
    if (one) return emails[one[2]] ? reply(200, emails[one[2]]) : reply(404, {});
    if (/^\/acc_[\w-]+\/emails$/.test(path)) return reply(200, { data: Object.values(emails) });
    return reply(404, {});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const intentFor = (user: User, channelId: string | null = null): MailConnectIntent => ({ userId: user.id, channelId, issuedAt: Date.now() });
const now = () => new Date().toISOString();

async function world() {
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "anna@ankora.co.il" });
  const { user: maor } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "maor@ankora.co.il" });
  const { user: hadas } = await createTestUser({ role: "SUPER_ADMIN", email: "hadas@ankora.co.il" });
  const grantor = await createTestClient({ name: "Grantor" });
  const levi = await createTestClient({ name: "לוי" });
  const marked = await createTestClient({ name: "חסוי" });
  await prisma.client.update({ where: { id: marked.id }, data: { aiExcluded: true } });
  for (const c of [grantor, levi, marked]) await prisma.userClientAccess.create({ data: { userId: anna.id, clientId: c.id } });
  await prisma.clientDomain.create({ data: { clientId: grantor.id, domain: "grantor.co.il", kind: "CLIENT" } });
  const dana = await prisma.person.create({ data: { name: "דנה", emails: ["dana.levi@gmail.com"] } });
  await prisma.clientContact.create({ data: { clientId: levi.id, personId: dana.id } });
  return { anna, maor, hadas, grantor, levi, marked };
}

async function scanningBox(owner: User, accountId = "acc_anna", address = "anna@ankora.co.il", clientId: string | null = null) {
  return prisma.mailChannel.create({ data: { accountId, address, ownerUserId: owner.id, clientId, kindChosenAt: new Date(), scanEnabled: true, scanStartedAt: new Date() } });
}

describe("connecting a mailbox on \"התיבות שלי\"", () => {
  it("connects an Ankora mailbox from the user's own signed intent, and adds it to the webhook", async () => {
    const { anna, maor } = await world();
    accounts.acc_new = { provider: "GOOGLE", status: "running", name: "Anna@Ankora.co.il", created_at: now() };
    accounts.acc_wa = { provider: "WHATSAPP", status: "running", name: "972500000000", created_at: now() };
    accounts.acc_old = { provider: "GOOGLE", status: "running", name: "old@x.co", created_at: "2026-01-01T00:00:00.000Z" };

    expect((await completeMailConnect(anna, null, { accountId: "acc_new", errorType: null })).result).toBe("expired");
    expect((await completeMailConnect(anna, intentFor(maor), { accountId: "acc_new", errorType: null })).result).toBe("expired");
    expect((await completeMailConnect(anna, intentFor(anna), { accountId: "acc_wa", errorType: null })).result).toBe("wrong-provider");
    expect((await completeMailConnect(anna, intentFor(anna), { accountId: "acc_old", errorType: null })).result).toBe("taken");
    expect(await completeMailConnect(anna, intentFor(anna), { accountId: null, errorType: "cancelled" })).toMatchObject({ result: "failed", failure: "provider-error" });
    expect(await completeMailConnect(anna, intentFor(anna), { accountId: null, errorType: null })).toMatchObject({ result: "failed", failure: "no-account" });
    expect(await completeMailConnect(anna, intentFor(anna), { accountId: "123", errorType: null })).toMatchObject({ result: "failed", failure: "bad-account-id" });

    const done = await completeMailConnect(anna, intentFor(anna), { accountId: "acc_new", errorType: null });
    expect(done.result).toBe("connected");
    const channel = await prisma.mailChannel.findUniqueOrThrow({ where: { id: done.channelId! } });
    // On the team's domain, so it is Ankora's: no "של מי" step, nothing scanned yet.
    expect(channel).toMatchObject({ address: "anna@ankora.co.il", ownerUserId: anna.id, clientId: null, scanEnabled: false });
    expect(channel.kindChosenAt).not.toBeNull();
    expect(webhookAccounts).toEqual(["acc_existing", "acc_new"]);
    expect(await prisma.auditEvent.count({ where: { action: "mail_channel.connected", entityId: channel.id } })).toBe(1);

    // Someone else coming back with the same account is refused.
    expect((await completeMailConnect(maor, intentFor(maor), { accountId: "acc_new", errorType: null })).result).toBe("taken");
  });

  it("does not connect a client's mailbox twice: it reads the account the client's screen connected", async () => {
    const { anna, hadas, grantor } = await world();
    const conn = await prisma.clientConnection.create({
      data: { clientId: grantor.id, kind: "UNIPILE_MAIL", account: "office@grantor.co.il", scopes: ["mail"], unipileAccountId: "acc_client", connectedById: hadas.id },
    });
    accounts.acc_dup = { provider: "GOOGLE", status: "running", name: "office@grantor.co.il", created_at: now() };

    const done = await completeMailConnect(anna, intentFor(anna), { accountId: "acc_dup", errorType: null });
    expect(done.result).toBe("reused");
    const channel = await prisma.mailChannel.findUniqueOrThrow({ where: { id: done.channelId! } });
    expect(channel).toMatchObject({ accountId: "acc_client", clientId: grantor.id, address: "office@grantor.co.il" });
    expect(seen.some((s) => s.method === "DELETE" && s.path === "/accounts/acc_dup")).toBe(true);
    expect(await prisma.auditEvent.count({ where: { action: "mail_channel.reused", entityId: channel.id } })).toBe(1);
    expect(conn.id).toBeTruthy();

    // The same address again later, under yet another account: the extra
    // account is removed too, and nothing new is made.
    accounts.acc_dup2 = { provider: "GOOGLE", status: "running", name: "office@grantor.co.il", created_at: now() };
    expect((await completeMailConnect(anna, intentFor(anna), { accountId: "acc_dup2", errorType: null })).result).toBe("connected");
    expect(seen.some((s) => s.method === "DELETE" && s.path === "/accounts/acc_dup2")).toBe(true);
    expect(await prisma.mailChannel.count()).toBe(1);
  });

  it("asks whose a mailbox is before the switch, and only a client the user works with", async () => {
    const { anna, maor, grantor } = await world();
    accounts.acc_box = { provider: "OUTLOOK", status: "running", name: "office@grantor.co.il", created_at: now() };
    const { channelId } = await completeMailConnect(anna, intentFor(anna), { accountId: "acc_box", errorType: null });
    await expect(startScanning(anna, channelId!)).rejects.toMatchObject({ code: "mailScan.kindFirst" });
    await expect(chooseMailboxKind(maor, channelId!, { kind: "ANKORA" })).rejects.toMatchObject({ code: "mailScan.notYourMailbox" });
    const strangerClient = await createTestClient({ name: "לא של אנה" });
    await expect(chooseMailboxKind(anna, channelId!, { kind: "CLIENT", clientId: strangerClient.id })).rejects.toMatchObject({ code: "mailScan.clientNotYours" });

    await chooseMailboxKind(anna, channelId!, { kind: "CLIENT", clientId: grantor.id });
    await startScanning(anna, channelId!);
    expect(await prisma.mailChannel.findUniqueOrThrow({ where: { id: channelId! } })).toMatchObject({ clientId: grantor.id, scanEnabled: true });
    await expect(chooseMailboxKind(anna, channelId!, { kind: "ANKORA" })).rejects.toMatchObject({ code: "mailScan.kindAfterScan" });
  });
});

describe("recording emails with clients", () => {
  it("records a thread with a client, who and when only, and leaves the rest alone", async () => {
    const { anna, grantor, levi } = await world();
    const box = await scanningBox(anna);
    email("em_team", "th_team", "hadas@ankora.co.il", ["anna@ankora.co.il"]);
    email("em_shop", "th_shop", "orders@shop.com", ["anna@ankora.co.il"]);
    email("em_g1", "th_g", "nadav@grantor.co.il", ["anna@ankora.co.il"], "2026-11-27T08:00:00.000Z");
    email("em_g2", "th_g", "anna@ankora.co.il", ["nadav@grantor.co.il", "office@grantor.co.il"], "2026-11-27T09:00:00.000Z");
    email("em_dana", "th_d", "dana.levi@gmail.com", ["anna@ankora.co.il"]);

    expect(await recordMailEvent("acc_anna", "em_team")).toBe("team");
    expect(await recordMailEvent("acc_anna", "em_shop")).toBe("no-client");
    expect(await recordMailEvent("acc_anna", "em_g1")).toBe("recorded");
    expect(await recordMailEvent("acc_anna", "em_g2")).toBe("updated");
    expect(await recordMailEvent("acc_anna", "em_g2")).toBe("same");
    expect(await recordMailEvent("acc_anna", "em_dana")).toBe("recorded");
    expect(await recordMailEvent("acc_unknown", "em_g1")).toBe("not-scanning");

    const threads = await prisma.mailThread.findMany({ where: { channelId: box.id }, orderBy: { externalThreadId: "asc" } });
    expect(threads.map((t) => [t.externalThreadId, t.clientIds, t.emailCount])).toEqual([
      ["th_d", [levi.id], 1],
      ["th_g", [grantor.id], 2],
    ]);
    const g = threads.find((t) => t.externalThreadId === "th_g")!;
    expect(g).toMatchObject({ lastEmailId: "em_g2", lastFromAddress: "anna@ankora.co.il" });
    expect(g.participants.sort()).toEqual(["anna@ankora.co.il", "nadav@grantor.co.il", "office@grantor.co.il"]);
    // Nothing of what was written is kept anywhere.
    expect(JSON.stringify(threads)).not.toContain("לא נשמר");
    expect((await prisma.mailChannel.findUniqueOrThrow({ where: { id: box.id } })).lastEmailAt?.toISOString()).toBe("2026-11-27T09:00:00.000Z");
  });

  it("records nothing before the switch", async () => {
    const { anna } = await world();
    await prisma.mailChannel.create({ data: { accountId: "acc_anna", address: "anna@ankora.co.il", ownerUserId: anna.id, kindChosenAt: new Date() } });
    email("em_g1", "th_g", "nadav@grantor.co.il", ["anna@ankora.co.il"]);
    expect(await recordMailEvent("acc_anna", "em_g1")).toBe("not-scanning");
    expect(await prisma.mailThread.count()).toBe(0);
  });
});

describe("\"לא לקרוא\"", () => {
  it("the owner's request holds what was recorded; a manager's approval deletes it and stops new ones", async () => {
    const { anna, maor, hadas } = await world();
    const box = await scanningBox(anna);
    email("em_g1", "th_g", "nadav@grantor.co.il", ["anna@ankora.co.il"]);
    await recordMailEvent("acc_anna", "em_g1");

    await expect(requestMailBlock(maor, { channelId: box.id, kind: "DOMAIN", value: "grantor.co.il", label: null })).rejects.toMatchObject({ code: "mailScan.notYourMailbox" });
    const block = await requestMailBlock(anna, { channelId: box.id, kind: "DOMAIN", value: "grantor.co.il", label: "Grantor" });
    expect(block.status).toBe("PENDING");
    expect((await prisma.mailThread.findFirstOrThrow()).held).toBe(true);

    await expect(decideMailBlock(anna, block.id, true)).rejects.toMatchObject({ code: "mailScan.managerDecides" });
    await decideMailBlock(hadas, block.id, true);
    expect(await prisma.mailThread.count()).toBe(0);
    await expect(decideMailBlock(hadas, block.id, true)).rejects.toMatchObject({ code: "mailScan.alreadyHandled" });

    email("em_g2", "th_g2", "nadav@grantor.co.il", ["anna@ankora.co.il"]);
    expect(await recordMailEvent("acc_anna", "em_g2")).toBe("blocked");
  });

  it("a rejected request lets the thread go back to normal", async () => {
    const { anna, hadas } = await world();
    const box = await scanningBox(anna);
    email("em_d", "th_d", "dana.levi@gmail.com", ["anna@ankora.co.il"]);
    await recordMailEvent("acc_anna", "em_d");
    const block = await requestMailBlock(anna, { channelId: box.id, kind: "ADDRESS", value: "dana.levi@gmail.com", label: null });
    expect((await prisma.mailThread.findFirstOrThrow()).held).toBe(true);
    await decideMailBlock(hadas, block.id, false);
    expect((await prisma.mailThread.findFirstOrThrow()).held).toBe(false);
  });

  it("offers the outside senders of the mailbox, and marks the ones already covered", async () => {
    const { anna } = await world();
    const box = await scanningBox(anna);
    email("e1", "t1", "nadav@grantor.co.il", ["anna@ankora.co.il"]);
    email("e2", "t2", "nadav@grantor.co.il", ["anna@ankora.co.il"]);
    email("e3", "t3", "service@bank.co.il", ["anna@ankora.co.il"]);
    email("e4", "t4", "hadas@ankora.co.il", ["anna@ankora.co.il"]);
    await prisma.mailBlock.create({ data: { channelId: box.id, kind: "DOMAIN", value: "bank.co.il", status: "APPROVED", requestedById: anna.id } });
    expect(await senderSuggestions(box)).toEqual([
      { address: "nadav@grantor.co.il", name: "nadav", count: 2, blocked: false },
      { address: "service@bank.co.il", name: "service", count: 1, blocked: true },
    ]);
  });
});

describe("the connector: list_connected_mailboxes", () => {
  it("shows an employee their own mailboxes and a manager every one, never email, never a marked client's name", async () => {
    const { anna, maor, hadas, grantor, marked } = await world();
    accounts.acc_anna = { provider: "GOOGLE", status: "running", name: "anna@ankora.co.il", created_at: now() };
    accounts.acc_grantor = { provider: "GOOGLE", status: "disconnected", name: "office@grantor.co.il", created_at: now() };
    accounts.acc_marked = { provider: "GOOGLE", status: "running", name: "office@marked.co.il", created_at: now() };
    const box = await scanningBox(anna);
    await scanningBox(anna, "acc_grantor", "office@grantor.co.il", grantor.id);
    await scanningBox(maor, "acc_marked", "office@marked.co.il", marked.id);
    email("em_g1", "th_g", "nadav@grantor.co.il", ["anna@ankora.co.il"]);
    await recordMailEvent("acc_anna", "em_g1");
    await setMailExtractionAllowed(hadas, box.id, false);

    const own = await call(anna, "list_connected_mailboxes", {});
    expect(own.isError).toBe(false);
    expect(own.json.mailboxes).toHaveLength(2);
    expect(own.json.mailboxes[0]).toMatchObject({ address: "anna@ankora.co.il", kind: "ANKORA", client: null, state: "scanning", threadsRecorded: 1, clientsInThreads: 1, extractionAllowed: false });
    expect(own.json.mailboxes[1]).toMatchObject({ address: "office@grantor.co.il", kind: "CLIENT", client: "Grantor", state: "disconnected" });
    expect(own.json.connectUrl).toMatch(/\/app\/whatsapp-poc\/mail\/connect$/);
    expect(own.json.fieldNotes.state).toContain("disconnected");
    expect(own.text).not.toContain("nadav@grantor.co.il");

    const all = await call(hadas, "list_connected_mailboxes", {});
    expect(all.json.mailboxes).toHaveLength(3);
    const hidden = all.json.mailboxes.find((m: { address: string }) => m.address === "office@marked.co.il");
    expect(hidden).toMatchObject({ kind: "CLIENT", client: null, clientAiExcluded: true });
    expect(all.text).not.toContain("חסוי");
  });
});

describe("a disconnected mailbox", () => {
  it("tells its owner once a day", async () => {
    const { anna } = await world();
    const box = await scanningBox(anna);
    expect(await alertMailChannelDisconnected("acc_anna")).toBe("sent");
    expect(await alertMailChannelDisconnected("acc_anna")).toBe("recent");
    expect(await alertMailChannelDisconnected("acc_nobody")).toBe("no-channel");
    const n = await prisma.notification.findFirstOrThrow({ where: { entityId: box.id } });
    expect(n).toMatchObject({ userId: anna.id, type: "mail_channel_disconnected" });
    expect(n.body).toContain("anna@ankora.co.il");
    expect(n.body).toContain("/app/whatsapp-poc/mail/connect");
  });
});
