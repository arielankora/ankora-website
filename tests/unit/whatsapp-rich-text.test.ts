import { describe, expect, it } from "vitest";
import { parseWhatsappText, phoneDigits } from "@/lib/whatsapp-poc/rich-text";

// 13.11.2026 (Ariel): a bold word showed with its asterisks, a link could
// not be clicked, a mention showed as a number.

describe("WhatsApp text", () => {
  it("reads bold, italic, strike and code", () => {
    expect(parseWhatsappText("אני צריך *שוב* להזיז")).toEqual([
      { t: "text", v: "אני צריך " },
      { t: "b", children: [{ t: "text", v: "שוב" }] },
      { t: "text", v: " להזיז" },
    ]);
    expect(parseWhatsappText("_a_ ~b~ `c`")).toEqual([
      { t: "i", children: [{ t: "text", v: "a" }] },
      { t: "text", v: " " },
      { t: "s", children: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "code", v: "c" },
    ]);
    expect(parseWhatsappText("*_x_*")).toEqual([{ t: "b", children: [{ t: "i", children: [{ t: "text", v: "x" }] }] }]);
  });

  it("leaves markers that do not close, or sit inside a word, as they are", () => {
    expect(parseWhatsappText("2*3 = 6")).toEqual([{ t: "text", v: "2*3 = 6" }]);
    expect(parseWhatsappText("snake_case_name")).toEqual([{ t: "text", v: "snake_case_name" }]);
    expect(parseWhatsappText("* not bold *")).toEqual([{ t: "text", v: "* not bold *" }]);
  });

  it("makes links, without trailing punctuation", () => {
    expect(parseWhatsappText("ראו https://ankora.co.il/a.")).toEqual([
      { t: "text", v: "ראו " },
      { t: "link", href: "https://ankora.co.il/a", v: "https://ankora.co.il/a" },
      { t: "text", v: "." },
    ]);
    expect(parseWhatsappText("www.x.com")).toEqual([{ t: "link", href: "https://www.x.com", v: "www.x.com" }]);
    expect(parseWhatsappText("javascript:alert(1)")).toEqual([{ t: "text", v: "javascript:alert(1)" }]);
  });

  it("marks mentions where Unipile says they are", () => {
    const text = "שלום @972523494293 מה נשמע";
    expect(parseWhatsappText(text, [{ start: 5, length: 13, userId: "972523494293@s.whatsapp.net" }])).toEqual([
      { t: "text", v: "שלום " },
      { t: "mention", v: "@972523494293", userId: "972523494293@s.whatsapp.net" },
      { t: "text", v: " מה נשמע" },
    ]);
    expect(parseWhatsappText("x", [{ start: 5, length: 3, userId: null }])).toEqual([{ t: "text", v: "x" }]);
    expect(phoneDigits("972523494293@s.whatsapp.net")).toBe("972523494293");
    expect(phoneDigits("abc")).toBeNull();
  });
});
