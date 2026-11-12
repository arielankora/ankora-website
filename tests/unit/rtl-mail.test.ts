import { describe, expect, it } from "vitest";
import { rtlMimeMessage } from "@/lib/rtl-mail";

// 5.11.2026 (task cmvtivumj000pjs08q9qj4t67): Hebrew mail reads right to
// left in Gmail, and a header cannot be smuggled in through a value.

const part = (raw: string, type: string) => {
  const i = raw.indexOf(`Content-Type: ${type}`);
  const body = raw.slice(i).split("\r\n\r\n")[1].split("\r\n")[0];
  return Buffer.from(body, "base64").toString("utf8");
};

describe("rtlMimeMessage", () => {
  it("sends a right-to-left HTML part and the same text as plain text", () => {
    const raw = rtlMimeMessage({ to: "a@b.co", subject: "בדיקה", text: "שורה ראשונה.\n\nשורה <שנייה>.", boundary: "x" });
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="x"');
    const html = part(raw, "text/html");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("<p style=\"margin:0 0 12px\">שורה ראשונה.</p>");
    expect(html).toContain("&lt;שנייה&gt;");
    expect(part(raw, "text/plain")).toBe("שורה ראשונה.\n\nשורה <שנייה>.");
  });

  it("keeps a line break in a value from adding a header", () => {
    const raw = rtlMimeMessage({ to: "a@b.co\r\nBcc: evil@x.co", subject: "x\nBcc: evil@x.co", text: "t", boundary: "x" });
    expect(raw.split("\r\n").filter((l) => l.startsWith("Bcc:"))).toEqual([]);
  });
});

// 12.11.2026 (ADR 0006, part B): the wrapper follows the language of the
// text it carries; the text is sent as written.
describe("rtlMimeMessage direction", () => {
  it("sends English text left to right, with lang en", () => {
    const raw = rtlMimeMessage({ to: "a@b.co", subject: "Monthly invoices", text: "Hi Dana,\n\nThe invoices for October are attached.", boundary: "x" });
    const html = part(raw, "text/html");
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain("text-align:left");
    expect(html).not.toContain('dir="rtl"');
    expect(part(raw, "text/plain")).toBe("Hi Dana,\n\nThe invoices for October are attached.");
  });

  it("keeps Hebrew right to left even when it opens with an English name", () => {
    const raw = rtlMimeMessage({ to: "a@b.co", subject: "x", text: "NUX: החשבוניות של אוקטובר מצורפות למייל הזה.", boundary: "x" });
    expect(part(raw, "text/html")).toContain('<html lang="he" dir="rtl">');
  });
});
