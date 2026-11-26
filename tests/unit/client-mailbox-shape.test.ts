import { describe, expect, it } from "vitest";
import { addressOf, bodyTextOf, eventOf, eventTimeOf, fullOf, htmlFromText, htmlToText, israelTimeOf, prefixedSubject, summaryOf, EMAIL_TEXT_CHARS } from "@/lib/client-mailbox/shape";

// 26.11.2026: a client's email as the connector hands it to Claude. What is
// worth holding: who, when (Israel time), the subject and the files with
// their ids come through; inline images stay out of the list; the text is
// read once, from the plain body or from the HTML; a long thread is cut.

const cv = {
  id: "em_1",
  thread_id: "th_1",
  date: "2026-11-20T08:15:00.000Z",
  subject: "קורות חיים: משרת רכזת גיוס",
  snippet: "מצורפים קורות החיים שלי",
  body_plain: "שלום,\r\n\r\n\r\n\r\nמצורפים קורות החיים שלי.\r\nדנה",
  from: [{ email: "dana@example.com", display_name: "Dana Levi" }],
  to: [{ email: "jobs@client.co.il", display_name: "jobs@client.co.il" }],
  cc: [],
  attachments: [
    { id: "att_cv", type: "file", filename: "Dana CV.pdf", mimetype: "application/pdf", file_size: 120_000, is_inline: false },
    { id: "att_logo", type: "img", mimetype: "image/png", is_inline: true },
  ],
  folders: ["INBOX", "Label_7"],
  is_unread: true,
};

describe("client mailbox shapes", () => {
  it("summarises an email: people, Israel time, subject, real attachments", () => {
    expect(summaryOf(cv)).toEqual({
      id: "em_1",
      threadId: "th_1",
      at: "2026-11-20 10:15",
      from: ["Dana Levi <dana@example.com>"],
      to: ["jobs@client.co.il"],
      cc: [],
      subject: "קורות חיים: משרת רכזת גיוס",
      snippet: "מצורפים קורות החיים שלי",
      unread: true,
      folders: ["INBOX", "Label_7"],
      attachments: [{ id: "att_cv", fileName: "Dana CV.pdf", mimeType: "application/pdf", sizeBytes: 120_000 }],
    });
    expect(summaryOf({ subject: "no id" })).toBeNull();
  });

  it("reads the plain text once, or the HTML when there is no plain text", () => {
    expect(bodyTextOf(cv)).toBe("שלום,\n\nמצורפים קורות החיים שלי.\nדנה");
    const html = { id: "x", body_plain: "", body: "<html><head><style>p{}</style></head><body><p>שורה&nbsp;אחת</p><p>A &amp; B<br>שתיים</p><ul><li>פריט</li></ul></body></html>" };
    expect(bodyTextOf(html)).toBe("שורה אחת\nA & B\nשתיים\n- פריט");
    expect(htmlToText("<script>alert(1)</script>טקסט")).toBe("טקסט");
  });

  it("lists inline files too in a full read, and cuts a long thread", () => {
    const [full] = fullOf([cv]);
    expect(full.attachments.map((a) => a.id)).toEqual(["att_cv", "att_logo"]);
    expect(full.textTruncated).toBe(false);

    const long = { id: "big", body_plain: "א".repeat(EMAIL_TEXT_CHARS + 500) };
    const thread = fullOf([long, { ...long, id: "big2" }, { ...long, id: "big3" }, { ...long, id: "big4" }]);
    expect(thread[0].text.length).toBe(EMAIL_TEXT_CHARS);
    expect(thread[0].textTruncated).toBe(true);
    expect(thread.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(60_000);
    expect(thread[3].text).toBe("");
  });

  it("says nothing for a missing or broken date", () => {
    expect(israelTimeOf(undefined)).toBeNull();
    expect(israelTimeOf("not a date")).toBeNull();
  });
});

// Stage 2 (26.11.2026): what goes out, and how a calendar event reads.
describe("client mailbox outgoing and calendar shapes", () => {
  it("reads addresses as people write them, and refuses what is not one", () => {
    expect(addressOf("Maya Cohen <maya@x.co.il>")).toEqual({ email: "maya@x.co.il", display_name: "Maya Cohen" });
    expect(addressOf('"Cohen, Maya" <maya@x.co.il>')).toEqual({ email: "maya@x.co.il", display_name: "Cohen, Maya" });
    expect(addressOf(" maya@x.co.il ")).toEqual({ email: "maya@x.co.il" });
    expect(addressOf("maya")).toBeNull();
    expect(addressOf("maya@x.co.il\nBcc: evil@x.co")).toBeNull();
  });

  it("does not stack Re: and Fwd:", () => {
    expect(prefixedSubject("Re", "שלום")).toBe("Re: שלום");
    expect(prefixedSubject("Re", "RE: שלום")).toBe("RE: שלום");
    expect(prefixedSubject("Fwd", "Fw: x")).toBe("Fw: x");
    expect(prefixedSubject("Fwd", undefined)).toBe("Fwd:");
  });

  it("writes Hebrew right to left and English left to right, escaped", () => {
    expect(htmlFromText("שלום <b>\nדנה")).toBe('<div dir="rtl" lang="he" style="text-align:right">שלום &lt;b&gt;<br>דנה</div>');
    expect(htmlFromText("Hello")).toContain('dir="ltr"');
  });

  it("shows an event in Israel time, an all-day event by its day, and who answered", () => {
    expect(eventTimeOf({ type: "datetime", date_time: "2026-11-30T12:00:00Z" })).toBe("2026-11-30 14:00");
    expect(eventTimeOf({ type: "datetime", date_time: "2026-11-30T14:00:00", timezone: "Asia/Jerusalem" })).toBe("2026-11-30 14:00");
    expect(eventTimeOf({ type: "date", date: "2026-12-01" })).toBe("2026-12-01");
    const e = eventOf({
      id: "ev",
      title: "ראיון",
      start: { type: "date", date: "2026-12-01" },
      is_all_day: true,
      attendees: [{ email: "dana@x.co", display_name: "Dana", response_status: "accepted", is_self: false }],
      conference: { provider: "google_meet", url: "https://meet.google.com/abc" },
      body: "<p>פרטים</p>",
    }, { withBody: true });
    expect(e).toMatchObject({ id: "ev", start: "2026-12-01", allDay: true, attendees: [{ who: "Dana <dana@x.co>", response: "accepted" }], conference: { url: "https://meet.google.com/abc" }, description: "פרטים" });
  });
});
