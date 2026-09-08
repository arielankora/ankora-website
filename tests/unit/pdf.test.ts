import { describe, expect, it } from "vitest";
import { toPdfTable } from "@/lib/pdf";

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec 14.4). Like
// lib/xlsx.ts, lib/pdf.ts imports neither Prisma nor anything that does
// (only pdfkit), so this test actually RUNS in this sandbox.
//
// This suite checks structural validity (a real, non-empty PDF is
// produced, pagination doesn't throw, the empty-state path works) - it
// does NOT re-assert visual Hebrew correctness programmatically. That
// was previously "verified" only via a manual pdftotext read during
// Phase 9 development, which turned out to be an insufficient check: a
// real live bug (docs/adr/0001 section 19.11, reported 2026-09-08)
// shipped anyway - lib/pdf.ts's since-removed manual bidi-js reordering
// step produced garbled/reversed Hebrew text in real exported reports,
// despite that earlier manual check appearing to pass. The actual fix
// (deleting the bidi-js step entirely - pdfkit already shapes Hebrew
// correctly on its own) was verified this time by rendering real PDFs
// to page images (pdftoppm) and reading the pixels directly at high
// zoom, not just extracting text. If this ever needs re-verifying,
// prefer that pixel-level check over pdftotext, whose own bidi/reading-
// order heuristics can mask a real rendering bug.
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
