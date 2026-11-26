import { describe, expect, it } from "vitest";
import { bodyTextOf, fullOf, htmlToText, israelTimeOf, summaryOf, EMAIL_TEXT_CHARS } from "@/lib/client-mailbox/shape";

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
