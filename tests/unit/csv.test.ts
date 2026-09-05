import { describe, expect, it } from "vitest";
import { csvField, toCsv } from "@/lib/csv";

// Phase 5 - spec 14.4 ("CSV חובה... UTF-8 BOM ב-CSV אם נדרש ל-Excel").
// lib/csv.ts has zero project imports (no "server-only", no prisma), so
// unlike almost every other unit test in this repo, this one actually
// runs in the sandbox - confirmed locally, not just on Vercel/CI.

describe("csvField()", () => {
  it("leaves a plain value unquoted", () => {
    expect(csvField("hello")).toBe("hello");
    expect(csvField(42)).toBe("42");
  });

  it("quotes and escapes a value containing a comma", () => {
    expect(csvField("a,b")).toBe('"a,b"');
  });

  it("quotes and doubles embedded quotes", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("leaves Hebrew text unquoted when it has no special characters", () => {
    expect(csvField("לקוח בדיקה")).toBe("לקוח בדיקה");
  });
});

describe("toCsv()", () => {
  it("prefixes a UTF-8 BOM so Hebrew opens correctly in Excel (spec 14.4)", () => {
    const csv = toCsv(["a"], [["b"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("joins header + rows with CRLF, comma-separated", () => {
    const csv = toCsv(["עובד", "דקות"], [["נועה", 30], ["איתי", 45]]);
    const withoutBom = csv.slice(1);
    expect(withoutBom).toBe("עובד,דקות\r\nנועה,30\r\nאיתי,45");
  });

  it("produces one line for headers even with zero data rows", () => {
    const csv = toCsv(["a", "b"], []);
    expect(csv.slice(1)).toBe("a,b");
  });
});
