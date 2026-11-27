import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// Stage 3 of "התיבות שלי" (27.11.2026, Ariel): knowledge extraction from the
// emails of scanned mailboxes, through the connector. What is worth holding:
// - only the extraction account or the mailbox's owner reads a thread; only
//   threads with a client, in mailboxes whose extraction is allowed, never
//   one that touches a client marked "בלי AI";
// - only the emails after where the last run stopped, and never one from
//   before scanning started (no old emails);
// - a thread is one source in the register, and proposing from it marks it
//   read; a thread with nothing to propose is marked by hand;
// - a contact's own details changed in that contact's own email enter on
//   their own; the same change written by someone else waits for a person;
// - what enters from emails is all looked at in its first 14 days.
// Unipile is stubbed.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { recordMailEvent } from "@/lib/mail-scan/channels";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { listAutoReview } from "@/lib/app-domain/auto-apply";

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

let emails: Record<string, Record<string, unknown>> = {};

function reply(status: number, body: unknown, type = "application/json"): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
}

function email(id: string, thread: string, from: string, to: string[], date: string, body: string, attachments: unknown[] = []) {
  emails[id] = { id, thread_id: thread, date, subject: "עדכון", body_plain: body, from: [{ email: from }], to: to.map((e) => ({ email: e })), attachments };
}

beforeEach(() => {
  emails = {};
  process.env.UNIPILE_API_KEY = "test-key";
  process.env.COMMS_EXTRACTION_ACCOUNTS = "";
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const path = new URL(String(input)).pathname.replace(/^\/v2/, "");
    const th = path.match(/^\/acc_[\w-]+\/threads\/([\w-]+)$/);
    if (th) return reply(200, { id: th[1], emails: Object.values(emails).filter((e) => e.thread_id === th[1]) });
    if (/\/attachments\/att_1$/.test(path)) return reply(200, "Invoice 2026-11: 4,500 ILS, due 1.12", "text/plain");
    const one = path.match(/^\/acc_[\w-]+\/emails\/([\w-]+)$/);
    if (one) return emails[one[1]] ? reply(200, emails[one[1]]) : reply(404, {});
    return reply(404, {});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function world() {
  const { user: ops } = await createTestUser({ role: "SUPER_ADMIN", email: "ops@ankora.co.il" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "anna@ankora.co.il" });
  const { user: maor } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "maor@ankora.co.il" });
  const client = await createTestClient({ name: "Grantor" });
  const marked = await createTestClient({ name: "חסוי" });
  await prisma.client.update({ where: { id: marked.id }, data: { aiExcluded: true } });
  for (const u of [ops, anna, maor]) for (const c of [client, marked]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: c.id } });
  await prisma.clientDomain.create({ data: { clientId: client.id, domain: "grantor.co.il", kind: "CLIENT" } });
  await prisma.clientDomain.create({ data: { clientId: marked.id, domain: "secret.co.il", kind: "CLIENT" } });
  await addClientSource(ops, { clientId: client.id, kind: "PERSON", title: "הדס" });
  const nadav = await addClientContact(ops, { clientId: client.id, name: "נדב דדון", role: "מנכ\"ל", emails: ["nadav@grantor.co.il"], phones: ["+972501111111"], relationship: "CLIENT_STAFF", sources: [{ code: "S1" }] });
  const dana = await addClientContact(ops, { clientId: client.id, name: "דנה", role: "כספים", emails: ["dana@grantor.co.il"], relationship: "CLIENT_STAFF", sources: [{ code: "S1" }] });
  const box = await prisma.mailChannel.create({
    data: { accountId: "acc_anna", address: "anna@ankora.co.il", ownerUserId: anna.id, kindChosenAt: new Date(), scanEnabled: true, scanStartedAt: new Date("2026-11-27T00:00:00Z") },
  });
  return { ops, anna, maor, client, marked, nadav, dana, box };
}

describe("reading threads for extraction", () => {
  it("the extraction account and the owner read; others do not; only new emails since scanning", async () => {
    const { ops, anna, maor, box } = await world();
    // Before scanning started: in the thread, but never read.
    email("e0", "t1", "nadav@grantor.co.il", ["anna@ankora.co.il"], "2026-11-20T08:00:00.000Z", "ישן");
    email("e1", "t1", "anna@ankora.co.il", ["nadav@grantor.co.il"], "2026-11-27T08:00:00.000Z", "שלום נדב, מה הטלפון החדש?");
    email("e2", "t1", "nadav@grantor.co.il", ["anna@ankora.co.il"], "2026-11-27T09:00:00.000Z", "נדב דדון | מנכ\"ל | 054-2222222", [{ id: "att_1", filename: "invoice.txt", mimetype: "text/plain" }]);
    await recordMailEvent("acc_anna", "e1");
    await recordMailEvent("acc_anna", "e2");
    email("s1", "t_secret", "boss@secret.co.il", ["anna@ankora.co.il"], "2026-11-27T09:00:00.000Z", "סודי");
    await recordMailEvent("acc_anna", "s1");

    const listed = await call(ops, "list_email_threads_to_extract", {});
    expect(listed.json.threads).toHaveLength(1);
    const thread = listed.json.threads[0];
    expect(thread).toMatchObject({ clients: ["Grantor"], mailbox: "anna@ankora.co.il", readThrough: null });
    expect(listed.text).not.toContain("secret");
    expect((await call(anna, "list_email_threads_to_extract", {})).json.threads).toHaveLength(1);
    expect((await call(maor, "list_email_threads_to_extract", {})).json.threads).toHaveLength(0);
    expect((await call(maor, "read_email_thread", { thread: thread.thread })).text).toContain("אין לך גישה");

    const read = await call(ops, "read_email_thread", { thread: thread.thread });
    expect(read.json.emails.map((e: { id: string; fromTeam: boolean }) => [e.id, e.fromTeam])).toEqual([
      ["e1", true],
      ["e2", false],
    ]);
    expect(read.json.newestAt).toBe("2026-11-27T09:00:00.000Z");
    expect(read.json.fieldNotes.emails).toBeTruthy();

    const file = await call(ops, "read_email_thread_attachment", { thread: thread.thread, emailId: "e2", attachmentId: "att_1" });
    expect(file.json.text).toContain("4,500 ILS");

    // A manager turns extraction off on the mailbox: nothing to read.
    await prisma.mailChannel.update({ where: { id: box.id }, data: { extractionAllowed: false } });
    expect((await call(ops, "list_email_threads_to_extract", {})).json.threads).toHaveLength(0);
  });
});

describe("proposing from a thread", () => {
  it("registers the thread once, marks it read, and lets the sender's own details in on their own", async () => {
    const { ops, client, nadav, dana } = await world();
    email("e1", "t1", "anna@ankora.co.il", ["nadav@grantor.co.il"], "2026-11-27T08:00:00.000Z", "שלום");
    email("e2", "t1", "nadav@grantor.co.il", ["anna@ankora.co.il", "dana@grantor.co.il"], "2026-11-27T09:00:00.000Z", "נדב דדון | מנכ\"ל | 054-2222222. דנה עכשיו סמנכ\"לית כספים.");
    await recordMailEvent("acc_anna", "e1");
    await recordMailEvent("acc_anna", "e2");
    const thread = (await call(ops, "list_email_threads_to_extract", {})).json.threads[0].thread;

    const bad = await call(ops, "propose_knowledge", {
      client: "Grantor",
      newSource: { kind: "EMAIL", title: "עדכון מנדב", mailThread: { thread: "nope", through: "2026-11-27T09:00:00.000Z" } },
      items: [{ target: "FACT", action: "CREATE", reason: "x", confidence: "HIGH", payload: { kind: "NOTE", body: "x" } }],
    });
    expect(bad.text).toContain("not this client's");

    const r = await call(ops, "propose_knowledge", {
      client: "Grantor",
      newSource: { kind: "EMAIL", title: "עדכון מנדב", date: "2026-11-27", mailThread: { thread, through: "2026-11-27T09:00:00.000Z" } },
      items: [
        // Nadav's own phone, in Nadav's own email: enters on its own.
        { target: "CONTACT", action: "SUPERSEDE", targetId: nadav.id, reason: "בחתימה של נדב", confidence: "HIGH", payload: { knowledgeStatus: "CONFIRMED", phones: ["+972542222222"] } },
        // Dana's role, written by Nadav: waits for a person.
        { target: "CONTACT", action: "SUPERSEDE", targetId: dana.id, reason: "נדב כתב", confidence: "HIGH", payload: { knowledgeStatus: "CONFIRMED", role: "סמנכ\"לית כספים" } },
      ],
    });
    expect(r.isError).toBe(false);
    const entered = r.json.batches?.[0]?.enteredFile ?? r.json.enteredFile;
    expect(entered).toHaveLength(1);

    expect((await prisma.person.findFirstOrThrow({ where: { emails: { has: "nadav@grantor.co.il" } } })).phones).toContain("+972542222222");
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: dana.id } })).role).toBe("כספים");

    const source = await prisma.clientSource.findFirstOrThrow({ where: { clientId: client.id, kind: "EMAIL" } });
    expect(source.externalRefs).toEqual([{ system: "MAIL", id: thread }]);
    expect((await prisma.mailThread.findUniqueOrThrow({ where: { id: thread } })).extractedThroughAt?.toISOString()).toBe("2026-11-27T09:00:00.000Z");
    expect((await call(ops, "list_email_threads_to_extract", {})).json.threads).toHaveLength(0);

    // A new email in the thread: only it is new, and the same source is used.
    email("e3", "t1", "dana@grantor.co.il", ["anna@ankora.co.il"], "2026-11-27T12:00:00.000Z", "תודה");
    await recordMailEvent("acc_anna", "e3");
    const again = (await call(ops, "list_email_threads_to_extract", {})).json.threads;
    expect(again).toEqual([expect.objectContaining({ thread, readThrough: "2026-11-27T09:00:00.000Z" })]);
    expect((await call(ops, "read_email_thread", { thread })).json.emails.map((e: { id: string }) => e.id)).toEqual(["e3"]);
    // Nothing to propose from it: marked by hand.
    expect((await call(ops, "mark_email_threads_extracted", { threads: [{ thread, through: "2026-11-27T12:00:00.000Z" }] })).json).toEqual({ marked: 1 });
    expect((await call(ops, "list_email_threads_to_extract", {})).json.threads).toHaveLength(0);

    // What entered from an email is on "נכנס אוטומטית" for a person to look at.
    const review = await listAutoReview(ops);
    expect(review).toEqual([expect.objectContaining({ whyCode: { code: "firstDays", days: 14 } })]);
  });
});
