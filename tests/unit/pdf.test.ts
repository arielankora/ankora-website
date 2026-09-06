import { describe, expect, it } from "vitest";
import { toPdfTable } from "@/lib/pdf";

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec 14.4). Like
// lib/xlsx.ts, lib/pdf.ts imports neither Prisma nor anything that does
// (only pdfkit + bidi-js), so this test actually RUNS in this sandbox.
//
// This suite checks structural validity (a real, non-empty PDF is
// produced, pagination doesn't throw, the empty-state path works) - it
// does NOT re-assert visual Hebrew correctness, which was verified
// separately and manually during development via pdftotext -bbox on a
// real rendered file (objective glyph x-position order, not a visual
// read): the title "דוח שעות לפי לקוח" extracted words in correct
// right-to-left reading order, and a three-word ordering probe
// ("ראשון שני שלישי") placed "ראשון" (first) rightmost and "שלישי"
// (third) leftmost, exactly as RTL rendering requires. That manual
// verification is what caught the real bug this phase fixed: pdfkit's
// font subsetter silently produces invisible glyphs from fontsource's
// .woff2 files (text layer fine, nothing painted, in both Poppler and
// Ghostscript) - registerFonts() in lib/pdf.ts now uses the plain .woff
// (v1) build of the same typeface for exactly this reason.
describe("toPdfTable()", () => {
  it("produces a real, non-empty PDF buffer", async () => {
    const buf = await toPdfTable({
      title: "דוח שעות לפי לקוח",
      headers: ["לקוח", "דקות"],
      rows: [["חברה בעמ", 120]],
    });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("renders the Hebrew empty-state message without throwing when there are no rows", async () => {
    const buf = await toPdfTable({ title: "דוח ריק", headers: ["א", "ב"], rows: [] });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("paginates without throwing when rows overflow one page", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => [`לקוח ${i}`, i]);
    const buf = await toPdfTable({ title: "דוח ארוך", headers: ["לקוח", "דקות"], rows });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    // A real multi-page PDF has more than one /Type /Page object.
    const pageObjectCount = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageObjectCount).toBeGreaterThan(1);
  });

  it("handles mixed Hebrew/Latin/numeric content in the same row without throwing", async () => {
    const buf = await toPdfTable({
      title: "Mixed",
      subtitle: "1.9.2026 - 30.9.2026",
      headers: ["לקוח", "אחוז"],
      rows: [["Global Tech Ltd", "82.6%"]],
    });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
