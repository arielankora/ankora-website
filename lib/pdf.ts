import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import bidiFactory from "bidi-js";

// Spec 14.4: "PDF לדוחות לקוח מומלץ" (recommended for client reports).
// Added in the Phase 9 gap-fix pass (docs/adr/0001 section 17) alongside
// XLSX - same (title, headers, rows) shape every export route already
// builds for CSV/XLSX.
//
// Two real problems had to be solved for a Hebrew PDF, neither of which
// pdfkit solves on its own:
//
// 1. Font coverage: pdfkit's built-in fonts (Helvetica etc.) are Latin-
//    only. This project already ships @fontsource/heebo (used by the
//    marketing site), but fontsource splits a font into per-script
//    *subset* files for web performance - the "hebrew" subset has no
//    Latin/digit glyphs and the "latin" subset has no Hebrew glyphs, so a
//    single doc.font(...) call can never render a mixed Hebrew+number
//    string (dates, minute counts, percentages all mix with Hebrew
//    labels in every report). Both subsets are registered here and each
//    run of text is drawn with whichever one actually has the glyphs.
// 2. Bidi: pdfkit has no Unicode Bidirectional Algorithm implementation -
//    it draws codepoints in string order, left to right, regardless of
//    script. Fed a raw Hebrew string it renders every word backwards.
//    `bidi-js` (a real UBA implementation) reorders each string into
//    left-to-right *visual* order first; drawing that reordered string
//    left-to-right then produces the correct on-page result, matching
//    what a browser or Word would show.
const bidi = bidiFactory();

const HEBREW_FONT = "Heebo-Hebrew";
const LATIN_FONT = "Heebo-Latin";

function registerFonts(doc: PDFKit.PDFDocument) {
  // NOTE: .woff (v1), not .woff2. Verified empirically (Phase 9 gap-fix,
  // docs/adr/0001 section 17): pdfkit's font subsetter silently produces
  // *invisible* glyphs when fed fontsource's .woff2 files - the PDF's
  // text layer is fine (copy/paste and pdftotext both extract correct
  // text) but nothing is actually painted, in both Poppler and
  // Ghostscript. The plain .woff build of the exact same typeface, same
  // weight, renders correctly. Root cause is almost certainly pdfkit/
  // fontkit's handling of WOFF2's transformed glyf/loca table layout
  // during subsetting; WOFF (v1) is just zlib-compressed sfnt tables, no
  // transform, so the normal TTF subsetting path applies untouched.
  //
  // `path.join(process.cwd(), ...)`, deliberately NOT `require.resolve()`.
  // Second and third real production bugs found via live QA (docs/adr/
  // 0001 sections 18.11-18.13):
  //   1. A plain relative-path string here throws `ENOENT` in prod/
  //      preview: pdfkit's `registerFont()` only *stores* the string,
  //      and the actual `fs.readFileSync(path)` happens later, resolved
  //      against the Lambda's cwd at runtime - invisible to Vercel's
  //      Node File Trace (NFT), the step deciding which files get
  //      copied into this route's deployed bundle, so the .woff files
  //      were never included.
  //   2. Switching to `require.resolve("@fontsource/heebo/files/...")`
  //      to fix (1) broke the *build itself*: webpack sees a literal
  //      `require.resolve("...")` call and tries to bundle the target as
  //      a JS module (that's what lets it return a module id/path at
  //      runtime) - but a `.woff` is binary with no loader configured,
  //      so webpack fails with "Module parse failed: Unexpected
  //      character". require.resolve() is safe for locating a file in
  //      plain Node (works fine locally); it is NOT safe as a way to
  //      merely "get a path" once webpack is bundling the calling code.
  //   3. The actual fix: build the path at runtime via `path.join(...)`
  //      (a plain string computed from `process.cwd()`, not a literal
  //      module specifier - webpack has nothing to statically bundle
  //      here) *and* rely on `next.config.mjs`'s
  //      `experimental.outputFileTracingIncludes` (added alongside this)
  //      to explicitly guarantee NFT copies the .woff files into this
  //      route's deployed bundle. That config is the one mechanism here
  //      that doesn't depend on any heuristic detecting a require-like
  //      call at all - it's a direct, unconditional include list.
  doc.registerFont(HEBREW_FONT, path.join(process.cwd(), "node_modules/@fontsource/heebo/files/heebo-hebrew-400-normal.woff"));
  doc.registerFont(LATIN_FONT, path.join(process.cwd(), "node_modules/@fontsource/heebo/files/heebo-latin-400-normal.woff"));
}

/// Splits a bidi-reordered string into consecutive runs of characters that
/// share the same font (Hebrew subset vs. Latin/digit subset), each run
/// drawn with a single doc.font() call. A code point present in neither
/// subset (rare - e.g. an unsupported symbol) falls back to the Latin
/// font, which pdfkit will simply skip/tofu rather than throw on.
function splitRuns(text: string): { font: string; text: string }[] {
  const runs: { font: string; text: string }[] = [];
  for (const ch of text) {
    const font = charFont(ch);
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.text += ch;
    else runs.push({ font, text: ch });
  }
  return runs;
}

// Hebrew block (incl. presentation forms/final letters) + common Hebrew
// punctuation/currency the "hebrew" fontsource subset actually ships.
const HEBREW_RANGE = /[֐-׿יִ-ﭏ]/;
function charFont(ch: string): string {
  return HEBREW_RANGE.test(ch) ? HEBREW_FONT : LATIN_FONT;
}

/// Draws one bidi-correct, mixed-font line of text right-aligned within
/// [x, x+width], vertically at y. Used for both header and body cells -
/// every report in this app is RTL Hebrew with embedded LTR numbers, so
/// there is no "sometimes LTR paragraph" case to also support.
function drawCell(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, opts: { bold?: boolean; size?: number } = {}) {
  const size = opts.size ?? 9;
  doc.fontSize(size);
  const levels = bidi.getEmbeddingLevels(text);
  const visual = bidi.getReorderedString(text, levels);
  const runs = splitRuns(visual);

  let totalWidth = 0;
  for (const run of runs) {
    doc.font(run.font);
    totalWidth += doc.widthOfString(run.text);
  }

  let cursorX = x + width - totalWidth; // right-aligned start
  for (const run of runs) {
    doc.font(run.font);
    doc.text(run.text, cursorX, y, { lineBreak: false });
    cursorX += doc.widthOfString(run.text);
  }
}

export interface PdfTableOptions {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  /// Relative column widths (sums are normalized to the page width) -
  /// defaults to equal-width columns.
  columnWeights?: number[];
}

/// Builds one A4-portrait, RTL Hebrew PDF table. Pagination (a new page
/// once rows run past the bottom margin) is handled manually - pdfkit has
/// no built-in table/pagination widget.
export function toPdfTable(opts: PdfTableOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // `font: false` is load-bearing, not cosmetic. Discovered via live QA on
    // the Phase 9 gap-fix Preview deployment (docs/adr/0001 section 18):
    // without it, pdfkit's constructor eagerly calls `.font("Helvetica")`
    // (its built-in default) before this function ever runs. Loading that
    // *standard* font requires pdfkit's Node build to
    // `require("#standard-fonts/Helvetica")` - a package.json "imports"
    // subpath resolved relative to pdfkit's own install location. Next.js's
    // serverless output-file-tracing does not follow that dynamic,
    // computed-specifier require() (it's invoked via a `createRequire`
    // handle stored in a variable, not a literal `require("...")` call), so
    // the .afm data file it points to is silently missing from the deployed
    // function's bundle -> `Error: Cannot find module
    // '#standard-fonts/Helvetica'` (MODULE_NOT_FOUND) at runtime in
    // production/preview, despite working perfectly under plain `node`
    // locally (incl. this file's own vitest suite) where node_modules is
    // intact on disk. `font: false` disables that eager default-font load
    // entirely; every actual text draw in this file goes through drawCell(),
    // which always explicitly sets HEBREW_FONT/LATIN_FONT (real embedded
    // fontsource files, not a pdfkit standard font) before drawing, so
    // pdfkit's standard-font loader is never invoked at all.
    // (@types/pdfkit's PDFDocumentOptions only types `font` as
    // `string | undefined`, missing pdfkit's own documented `false` option,
    // hence the cast.)
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      bufferPages: true,
      font: false,
    } as unknown as PDFKit.PDFDocumentOptions);
    registerFonts(doc);

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const weights = opts.columnWeights ?? opts.headers.map(() => 1);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const colWidths = weights.map((w) => (w / weightSum) * pageWidth);
    // RTL columns: first header is rightmost on the page.
    const colX: number[] = [];
    let acc = doc.page.margins.left;
    for (const w of colWidths) {
      colX.push(acc);
      acc += w;
    }
    colX.reverse(); // header[0] gets the rightmost x

    drawCell(doc, opts.title, doc.page.margins.left, doc.page.margins.top, pageWidth, { size: 16 });
    let y = doc.page.margins.top + 26;
    if (opts.subtitle) {
      drawCell(doc, opts.subtitle, doc.page.margins.left, y, pageWidth, { size: 10 });
      y += 20;
    }
    y += 8;

    const rowHeight = 20;
    const bottomLimit = doc.page.height - doc.page.margins.bottom;

    function drawHeaderRow() {
      opts.headers.forEach((h, i) => drawCell(doc, h, colX[i], y, colWidths[i], { size: 9 }));
      doc
        .moveTo(doc.page.margins.left, y + 16)
        .lineTo(doc.page.width - doc.page.margins.right, y + 16)
        .strokeColor("#999999")
        .stroke();
      y += rowHeight;
    }

    drawHeaderRow();

    for (const row of opts.rows) {
      if (y + rowHeight > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeaderRow();
      }
      row.forEach((cell, i) => drawCell(doc, String(cell), colX[i], y, colWidths[i], { size: 9 }));
      y += rowHeight;
    }

    if (opts.rows.length === 0) {
      drawCell(doc, "אין נתונים להצגה בטווח שנבחר.", doc.page.margins.left, y, pageWidth, { size: 9 });
    }

    doc.end();
  });
}
