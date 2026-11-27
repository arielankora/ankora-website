import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// Stage 2 (26.11.2026, Ariel: "להמליץ על טיוטה אבל לאפשר גם שליחה בבקשה
// מפורשת"): writing to a client's mailbox and calendar through the connector.
// What is worth holding:
// - nothing is sent without userAskedToSend, and the refusal says to draft;
// - a reply goes to the right people in the thread, a forward carries the
//   original's files, and Hebrew goes out right to left;
// - labels are added to what an email has, not instead of it;
// - calendar times are Israel time, guests are not invited unless asked,
//   and an IMAP mailbox has no calendar;
// - every write is audited without its text.
// Unipile is stubbed; the requests Ankora makes are what is checked.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { eventTime } from "@/lib/client-mailbox/calendar";

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

type Seen = { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null };
let seen: Seen[] = [];
const sent = (path: string, method = "POST") => seen.filter((s) => s.path === path && s.method === method);

const ORIGINAL = {
  id: "em_1",
  thread_id: "th_1",
  date: "2026-11-20T08:15:00.000Z",
  subject: "קורות חיים: רכזת גיוס",
  body_plain: "שלום, מצורפים קורות החיים שלי. דנה",
  from: [{ email: "dana@example.com", display_name: "Dana Levi" }],
  to: [{ email: "jobs@career.co.il" }],
  cc: [{ email: "hr@career.co.il" }, { email: "noa@example.com" }],
  attachments: [
    { id: "att_cv", filename: "dana-cv.pdf", mimetype: "application/pdf", is_inline: false },
    { id: "att_logo", mimetype: "image/png", is_inline: true },
  ],
  folders: ["INBOX", "Label_1"],
};

function reply(status: number, body: unknown, type = "application/json"): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
}

beforeEach(() => {
  seen = [];
  process.env.UNIPILE_API_KEY = "test-key";
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v2/, "");
    const method = init?.method ?? "GET";
    seen.push({ method, path, query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (/^\/accounts\/acc_(mail|imap)$/.test(path)) {
      return reply(200, { object: "Account", id: path.split("/")[2], provider: path.endsWith("imap") ? "IMAP" : "GOOGLE", status: "running", name: "x" });
    }
    if (path === "/acc_mail/emails/em_1" && method === "GET") return reply(200, ORIGINAL);
    if (path === "/acc_mail/emails/em_1/attachments/att_cv") return reply(200, "%PDF-fake", "application/pdf");
    if (path === "/acc_mail/drafts" && method === "POST") return reply(200, { object: "EmailDraft", id: "dr_1", subject: "x", to: [] });
    if (path === "/acc_mail/emails/send") return reply(200, { object: "EmailSent", id: "sent_1" });
    if (path === "/acc_mail/emails/em_1/modify") return reply(200, {});
    if (path === "/acc_mail/calendars" && method === "GET") return reply(200, { data: [{ id: "cal_other", name: "Other" }, { id: "cal_main", name: "Main", is_default: true }] });
    if (path === "/acc_mail/calendars/cal_main/events" && method === "GET") {
      return reply(200, {
        data: [
          {
            id: "ev_1",
            calendar_id: "cal_main",
            title: "ראיון: דנה",
            start: { type: "datetime", date_time: "2026-11-30T12:00:00Z" },
            end: { type: "datetime", date_time: "2026-11-30T13:00:00Z" },
            attendees: [{ email: "dana@example.com", response_status: "accepted" }],
            transparency: "opaque",
          },
        ],
      });
    }
    if (path === "/acc_mail/calendars/cal_main/events" && method === "POST") {
      return reply(200, { id: "ev_new", calendar_id: "cal_main", title: "ראיון", start: { type: "datetime", date_time: "2026-11-30T14:00:00", timezone: "Asia/Jerusalem" } });
    }
    if (path.startsWith("/acc_mail/calendars/cal_main/events/ev_1/")) return reply(200, {});
    return reply(404, {});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function world() {
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const client = await createTestClient({ name: "קריירה ועוד" });
  const imapClient = await createTestClient({ name: "תיבה רגילה" });
  for (const c of [client, imapClient]) await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: c.id } });
  // 27.11.2026: a client mailbox is open by role; Hadas is the account
  // manager of both clients here.
  for (const c of [client, imapClient]) await prisma.client.update({ where: { id: c.id }, data: { accountManagerId: hadas.id } });
  const row = await prisma.clientConnection.create({
    data: { clientId: client.id, kind: "UNIPILE_MAIL", account: "jobs@career.co.il", scopes: ["mail", "calendar"], unipileAccountId: "acc_mail", connectedById: hadas.id },
  });
  await prisma.clientConnection.create({
    data: { clientId: imapClient.id, kind: "UNIPILE_MAIL", account: "box@plain.co.il", scopes: ["mail"], unipileAccountId: "acc_imap", connectedById: hadas.id },
  });
  return { hadas, row };
}

const C = "קריירה ועוד";

describe("writing to a client mailbox through the connector", () => {
  it("never sends without the user's explicit request, and says to draft instead", async () => {
    const { hadas } = await world();
    const refused = await call(hadas, "send_client_email", { client: C, to: ["a@b.co"], text: "שלום", userAskedToSend: false });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("save_client_email_draft");
    expect(sent("/acc_mail/emails/send")).toHaveLength(0);
  });

  it("drafts a reply-all in the thread, to the right people, right to left", async () => {
    const { hadas, row } = await world();
    const draft = await call(hadas, "save_client_email_draft", { client: C, replyToEmailId: "em_1", replyAll: true, text: "תודה דנה, נחזור אלייך השבוע." });
    expect(draft.isError).toBe(false);
    expect(draft.json).toMatchObject({ draftId: "dr_1", kind: "reply", to: ["dana@example.com"], cc: ["hr@career.co.il", "noa@example.com"], subject: "Re: קורות חיים: רכזת גיוס" });
    const body = sent("/acc_mail/drafts")[0].body!;
    expect(body.reply_to_message_id).toBe("em_1");
    expect(body.reply_to_provider_id).toBeUndefined();
    expect(body.plain_text).toBe("תודה דנה, נחזור אלייך השבוע.");
    expect(String(body.html)).toContain('dir="rtl"');
    expect(body).not.toHaveProperty("tracking_options");

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "connection.mail_write", entityId: row.id } });
    expect(audit.afterJson).toMatchObject({ what: "draft_create", kind: "reply", to: ["dana@example.com"] });
    expect(JSON.stringify(audit)).not.toContain("נחזור אלייך");
  });

  it("forwards on an explicit request, with the original's files and the original quoted", async () => {
    const { hadas } = await world();
    const out = await call(hadas, "send_client_email", { client: C, forwardEmailId: "em_1", to: ["Maya Partner <partner@career.co.il>"], text: "מועמדת מתאימה לראיון.", userAskedToSend: true });
    expect(out.isError).toBe(false);
    expect(out.json).toMatchObject({ sent: true, kind: "forward", emailId: "sent_1", attachments: ["dana-cv.pdf"], subject: "Fwd: קורות חיים: רכזת גיוס" });
    const body = sent("/acc_mail/emails/send")[0].body!;
    expect(body.to).toEqual([{ email: "partner@career.co.il", display_name: "Maya Partner" }]);
    expect(body.attachments).toEqual([{ filename: "dana-cv.pdf", content_type: "application/pdf", content: Buffer.from("%PDF-fake").toString("base64") }]);
    expect(String(body.plain_text)).toMatch(/^מועמדת מתאימה לראיון\.\n\n---------- Forwarded message ---------\nFrom: Dana Levi <dana@example.com>/);
    expect(String(body.plain_text)).toContain("שלום, מצורפים קורות החיים שלי. דנה");
  });

  it("adds a label to the ones an email has, not instead of them", async () => {
    const { hadas } = await world();
    const out = await call(hadas, "organize_client_email", { client: C, emailIds: ["em_1"], action: "add_folders", folderIds: ["Label_9"] });
    expect(out.isError).toBe(false);
    expect(sent("/acc_mail/emails/em_1/modify")[0].body).toEqual({ folders_ids: ["INBOX", "Label_1", "Label_9"] });
    const cats = await call(hadas, "organize_client_email", { client: C, emailIds: ["em_1"], action: "set_categories", categories: ["x"] });
    expect(cats.text).toContain("Outlook");
  });
});

describe("a client calendar through the connector", () => {
  it("reads the main calendar, creates in Israel time without inviting, and answers an invitation", async () => {
    const { hadas, row } = await world();
    const list = await call(hadas, "list_client_calendar_events", { client: C, from: "2026-11-30", to: "2026-11-30" });
    expect(list.json).toMatchObject({ calendarId: "cal_main", events: [{ id: "ev_1", title: "ראיון: דנה", start: "2026-11-30 14:00", busy: true }] });
    const q = seen.find((s) => s.path === "/acc_mail/calendars/cal_main/events")!.query;
    expect(q.get("start")).toBe("2026-11-29T22:00:00.000Z");

    const made = await call(hadas, "save_client_calendar_event", { client: C, title: "ראיון", start: "2026-11-30T14:00", end: "2026-11-30T15:00", attendees: ["dana@example.com"], videoCall: "google_meet" });
    expect(made.json).toMatchObject({ guestsNotified: false, event: { id: "ev_new" } });
    const body = sent("/acc_mail/calendars/cal_main/events")[0].body!;
    expect(body).toMatchObject({
      title: "ראיון",
      start: { type: "datetime", date_time: "2026-11-30T14:00:00", timezone: "Asia/Jerusalem" },
      attendees: [{ email: "dana@example.com", type: "required" }],
      conference: { provider: "google_meet" },
      notify: "none",
    });

    await call(hadas, "respond_client_calendar_event", { client: C, eventId: "ev_1", action: "decline", comment: "לא פנויה" });
    expect(sent("/acc_mail/calendars/cal_main/events/ev_1/rsvp")[0].body).toEqual({ status: "no", comment: "לא פנויה" });

    const actions = (await prisma.auditEvent.findMany({ where: { entityId: row.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["connection.calendar_read", "connection.calendar_write", "connection.calendar_write"]);
  });

  it("has no calendar for an IMAP mailbox, and reads times as the person means them", async () => {
    const { hadas } = await world();
    const none = await call(hadas, "list_client_calendar_events", { client: "תיבה רגילה" });
    expect(none.isError).toBe(true);
    expect(none.text).toContain("box@plain.co.il");
    expect(eventTime("2026-12-01")).toEqual({ type: "date", date: "2026-12-01" });
    expect(eventTime("2026-12-01 09:30")).toEqual({ type: "datetime", date_time: "2026-12-01T09:30:00", timezone: "Asia/Jerusalem" });
    expect(eventTime("2026-12-01T09:30:00Z")).toEqual({ type: "datetime", date_time: "2026-12-01T09:30:00Z" });
  });
});
