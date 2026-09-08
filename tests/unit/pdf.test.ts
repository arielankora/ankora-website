import { describe, expect, it } from "vitest";
import { toPdfTable } from "@/lib/pdf";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec 14.4). Like
// lib/xlsx.ts, lib/pdf.ts imports neither Prisma nor anything that does
// (only pdfkit), so this test actually RUNS in this sandbox.
//
// This suite checks structural validity (a real, non-empty PDF is
// produced, pagination doesn't throw, the empty-state path works) AND,
// separately, RTL glyph-order correctness - see the "RTL glyph order"
// describe block below.
//
// docs/adr/0001 section 19.12 is the reason that second block exists at
// all: an earlier "fix" for reversed Hebrew in this exact file was
// verified only by eyeballing pdftotext output locally, shipped, and
// turned out to still be broken on the real Vercel runtime. The root
// problem with pdftotext (and pdf.js's own getTextContent()) for this
// purpose is that both do their own bidi-aware text reconstruction when
// extracting - which can silently paper over a real visual-ordering bug
// instead of surfacing it. The only reliable check is reading the raw
// PDF content-stream operators (getOperatorList()'s showText args) to
// see the actual sequence of glyphs pdfkit painted left-to-right, with
// no extraction-side "helpfulness" in between. That's what these tests
// do via pdfjs-dist - the same technique used to live-diagnose and
// confirm the fix on an actual Vercel Preview deployment before this
// landed.
//
// (Font-coverage note, unrelated to RTL ordering: pdfkit's font
// subsetter silently produces invisible glyphs from fontsource's .woff2
// files - text layer fine, nothing painted, in both Poppler and
// Ghostscript. registerFonts() in lib/pdf.ts uses the plain .woff (v1)
// build of the same typeface for exactly this reason.)

/// Renders `text` alone (as a title, so it goes through exactly one
/// drawCell() call) and returns the actual left-to-right sequence of
/// glyphs pdfkit painted, read back from the raw PDF content stream via
/// pdfjs-dist's getOperatorList() - not getTextContent() or pdftotext,
/// both of which reconstruct bidi order themselves (see file header).
// toPdfTable() always draws a header row (and, with no rows, an
// empty-state message) after the title, so isolating just the title's
// own painted glyphs means stopping once the font size drops away from
// the title's size (16 - see toPdfTable()'s `drawCell(doc, opts.title,
// ..., { size: 16 })` call) - every other piece of text on the page
// (headers, cells, the empty-state message) uses size 9.
async function renderedGlyphOrder(text: string): Promise<string> {
  const buf = await toPdfTable({ title: text, headers: ["x"], rows: [] });
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await doc.getPage(1);
  const opList = await page.getOperatorList();
  const OPS = (pdfjsLib as any).OPS;
  let currentSize: number | null = null;
  let out = "";
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] === OPS.setFont) {
      currentSize = opList.argsArray[i][1];
      continue;
    }
    if (opList.fnArray[i] !== OPS.showText) continue;
    if (currentSize !== 16) break; // left the title's own text
    for (const g of opList.argsArray[i][0]) {
      if (typeof g === "object" && g.unicode) out += g.unicode;
    }
  }
  return out;
}
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

describe("RTL glyph order (docs/adr/0001 section 19.12)", () => {
  // NOTE: the expected strings below are each computed BY HAND (in the
  // PR description / ADR 19.12, not by re-running lib/pdf.ts's own
  // run-splitting logic) - deriving "expected" from the same splitRuns()
  // this test is meant to catch bugs in would let a shared bug pass
  // silently. Correct RTL painting means: reverse the ORDER of same-
  // script runs, but never a run's own internal character order - a
  // naive whole-string char reversal is wrong whenever more than one
  // run is involved (it also flips each run's own characters), which is
  // why only the single-word case below uses that shortcut.

  it("draws a single Hebrew word so the painted glyph sequence, read right-to-left, spells it correctly", async () => {
    // Regression guard for the double-reversal bug: a lone word (exactly
    // the shape every table header and most name/category cells take)
    // is the case that broke when this file also ran bidi-js's
    // getReorderedString() before drawing - see the file-header comment
    // in lib/pdf.ts. With exactly one run, whole-string reversal IS
    // "reverse run order" (there's only one run), so this shortcut is
    // valid here specifically.
    const drawn = await renderedGlyphOrder("לקוח");
    expect(Array.from(drawn).reverse().join("")).toBe("לקוח");
  });

  it("draws a multi-word Hebrew phrase with runs in reversed (RTL) order, each Hebrew run's own glyphs shaped by fontkit", async () => {
    const drawn = await renderedGlyphOrder("דוח שעות לפי לקוח");
    // Runs, in logical/typed order: "דוח" " " "שעות" " " "לפי" " " "לקוח".
    // lib/pdf.ts reverses the RUN order only ("לקוח" " " "לפי" " " "שעות"
    // " " "דוח") and hands each run's text to doc.text() UNCHANGED - but
    // pdfkit/fontkit's own RTL shaping then reverses each *Hebrew* run's
    // own glyph sequence again when painting it (same as the single-word
    // case above; empirically confirmed, not this codebase's doing), so
    // the raw content-stream order captured here has each word spelled
    // backwards individually while the WORD order is the correct RTL
    // one. Reading right-to-left, word by word, then each word's own
    // glyphs right-to-left too, spells out the original phrase correctly
    // - see docs/adr/0001 section 19.12 for the full reasoning and the
    // live-Preview visual confirmation this was checked against.
    expect(drawn).toBe("חוקל יפל תועש חוד");
  });

  it("keeps an embedded LTR number run in its own left-to-right order, not reversed", async () => {
    // The exact shape that motivated adding this describe block: a
    // Hebrew phrase with a number range in the middle ("2026 - 31"),
    // which a naive whole-string reversal would incorrectly flip to
    // "31 - 2026".
    const drawn = await renderedGlyphOrder("1 בינואר 2026 - 31 בינואר 2026");
    // Runs, in logical/typed order: "1 " "בינואר" " 2026 - 31 " "בינואר"
    // " 2026". lib/pdf.ts reverses run order only; fontkit then reshapes
    // each Hebrew run ("בינואר" -> "ראוניב") when painting it, same as
    // above - but a Latin/digit run ("1 ", " 2026 - 31 ", " 2026") gets
    // no such treatment from fontkit and keeps its own left-to-right
    // character order exactly as typed:
    expect(drawn).toBe(" 2026ראוניב 2026 - 31 ראוניב1 ");
  });
});
