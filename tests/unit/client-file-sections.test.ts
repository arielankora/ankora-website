import { describe, expect, it, vi } from "vitest";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ClientFileDoc } from "@/lib/client-file-document";

// Sections of the client file built from work already done
// (claude/org-brain-spec-2026-10-12.md, 6.1), and the file as a PDF.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { batchItem, oneOffSuppliers, ruleSection, ONE_OFF_GROUP } = await import("@/lib/client-file-sections");
const { clientFileBlocks, renderClientFilePdf } = await import("@/lib/client-file-pdf");

const day = (d: Date) => d.toISOString().slice(0, 10);

describe("ruleSection", () => {
  it("reads each kind of rule with the section it belongs to", () => {
    expect(["THRESHOLD", "APPROVAL_REQUIRED"].map(ruleSection)).toEqual(["8", "8"]);
    expect(ruleSection("COMMUNICATION")).toBe("9");
    expect(["INFO", "DATA_HANDLING"].map(ruleSection)).toEqual(["14", "14"]);
    expect(["FORBIDDEN", "SEPARATION", "REQUIRED_STEP", "TIMING", "DISCLOSURE"].map(ruleSection)).toEqual(["6", "6", "6", "6", "6"]);
  });
});

describe("oneOffSuppliers", () => {
  const t = (title: string, supplierName: string, at: string, supplierExperience: "GOOD" | "OK" | "AVOID" | null = null) => ({
    title,
    supplierName,
    supplierExperience,
    supplierRecordedAt: new Date(at),
    createdAt: new Date(at),
  });

  it("one line per supplier, newest first, with the latest experience; a known organization is not repeated", () => {
    const items = oneOffSuppliers(
      [
        t("הובלת ריהוט", "הובלות כהן", "2026-09-01", "OK"),
        t("הובלה למשרד", " הובלות  כהן ", "2026-10-01", "GOOD"),
        t("ספר חשבונות", "Nextage", "2026-10-02"),
        t("ניקוי שטיחים", "שטיחי זוהר", "2026-08-01"),
      ],
      ["nextage"],
      day
    );
    expect(items.map((i) => i.text)).toEqual(["הובלות כהן", "שטיחי זוהר"]);
    expect(items[0].details).toEqual(["2 משימות, האחרונה: הובלה למשרד", "2026-10-01", "מומלץ"]);
    expect(items[1].details).toEqual(["משימה: ניקוי שטיחים", "2026-08-01", null]);
    expect(items.every((i) => i.group === ONE_OFF_GROUP)).toBe(true);
  });
});

describe("batchItem", () => {
  it("says when, from which source, and what became of the proposals", () => {
    const item = batchItem({ createdAt: new Date("2026-10-17T09:00:00Z"), via: "MCP", note: "בלי חלק המחירים", source: { code: "S5", title: "NUX file import" }, states: ["APPROVED", "APPROVED", "REJECTED", "PENDING"] }, day);
    expect(item.text).toBe("2026-10-17: NUX file import");
    expect(item.details).toEqual(["מ-Claude", "4 הצעות", "2 אושרו", "1 נדחו", "1 ממתינות", "בלי חלק המחירים"]);
    expect(item.sources).toEqual(["S5"]);
  });
});

const sample: ClientFileDoc = {
  clientName: "NUX",
  generatedAt: new Date("2026-10-17T09:00:00Z"),
  audience: "staff",
  control: [{ text: "אין עדיין תהליכים", warn: false }],
  sections: [
    { number: "7.2", title: "ספקים ונותני שירות", empty: "אין.", items: [{ text: "Nextage", details: ["הנהלת חשבונות"], status: "UNCERTAIN", toResolve: "לאשר עם אורן", sources: ["S1 08:13"] }] },
    { number: "8", title: "כספים וכללי אישור", empty: "אין עדיין עובדות כספיות או כללי אישור.", items: [] },
  ],
  legend: [{ code: "S1", title: "Nextage & Ankora", details: "הקלטה" }],
};

describe("the client file as a PDF", () => {
  it("lays out the same lines as the Markdown, an empty section as one line", () => {
    const blocks = clientFileBlocks(sample);
    const texts = blocks.map((b) => ("text" in b ? b.text : ""));
    expect(texts).toContain("בקרה: אין עדיין תהליכים");
    expect(texts).toContain("7.2. ספקים ונותני שירות");
    expect(texts).toContain("• Nextage (הנהלת חשבונות) לא ודאי: לאשר עם אורן [S1 08:13]");
    expect(texts).toContain("8. כספים וכללי אישור: אין עדיין עובדות כספיות או כללי אישור.");
    expect(texts.at(-1)).toBe("S1: Nextage & Ankora (הקלטה)");
  });

  it("renders an A4 PDF with the footer on every page", async () => {
    const buf = await renderClientFilePdf(sample);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const page = await pdf.getPage(1);
    expect(Math.round(page.view[2])).toBe(595);
    const text = (await page.getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join("");
    expect(text).toContain("ANKORA CLIENT FILE");
    expect(text).toContain("Nextage");
  });
});
