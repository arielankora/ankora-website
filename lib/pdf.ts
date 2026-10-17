import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";

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
// 2. Bidi/RTL word order: pdfkit draws whatever doc.text() is given, left
//    to right, run by run, at whatever x each doc.text() call is told to
//    start at - it has no paragraph-level bidi algorithm and doesn't need
//    one here, because pdfkit's font/subsetting layer (fontkit) *already*
//    reorders the glyphs of a single doc.text() call that is entirely
//    RTL-range codepoints into correct visual order on its own. This was
//    proven empirically (docs/adr/0001 section 19.12) by drawing a plain,
//    untouched Hebrew word with a single doc.font(HEBREW_FONT).text(...)
//    call and observing it render correctly, with NO reordering applied
//    by this code at all.
//
//    An earlier version of this file additionally ran every string
//    through `bidi-js`'s getReorderedString() before drawing, reasoning
//    (wrongly) that pdfkit needed a UBA pass done for it. It didn't: that
//    pre-reversed each run's characters, and fontkit's own shaping then
//    reversed them *again* when painting - two reversals cancel out to
//    the *original* logical order, which is exactly backwards for RTL.
//    For any cell that reduces to a single Hebrew run after splitRuns()
//    (a bare word - every table header, most client/category names) that
//    double-reversal was visible immediately. It was invisible for
//    multi-word phrases only by accident: splitRuns() already breaks a
//    phrase into one run per word at every space boundary (space isn't
//    in HEBREW_RANGE), so bidi-js's word-order flip survived even though
//    each word's own double-reversed characters happened to cancel back
//    to correct spelling - two unrelated bugs masking each other on the
//    one shape of input (multi-word, no digits) that happened to get
//    tested. Confirmed via a live-Preview diagnostic (not local sandbox -
//    an earlier attempt at this exact fix was verified only locally and
//    turned out to still be broken on Vercel's actual runtime) that
//    rendered isolated, labeled test strings and read the actual
//    per-glyph PDF content-stream order back out with pdf.js.
//
//    The fix: don't touch each run's characters at all - draw every run
//    exactly as typed and let fontkit's own per-run auto-reversal do the
//    only character-level RTL work it's already doing correctly. The one
//    thing this file must still do is *decide run order*: visually, an
//    RTL line's *last* logical run (its rightmost reading-start) has to
//    be drawn first/leftmost and its first logical run drawn last/
//    rightmost - i.e. splitRuns() output, reversed, drawn left-to-right
//    with a plain increasing cursor. A Latin/digit run's own internal
//    order is left untouched by this reversal (only the *array* of runs
//    is reversed, never the characters inside one), which is what keeps
//    embedded numbers (dates, hour counts, "24/7") reading left-to-right
//    like the rest of this app - see drawCell() below.
//
// NOTE: this app has no "sometimes LTR paragraph" case to also support -
// every report is RTL Hebrew with embedded LTR numbers - so this
// run-order-reversal approach (not a general Unicode Bidi Algorithm
// implementation) is deliberately as simple as the real requirement.

export const HEBREW_FONT = "Heebo-Hebrew";
export const LATIN_FONT = "Heebo-Latin";

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

/// Splits raw, logical-order text into consecutive runs of characters that
/// share the same font (Hebrew subset vs. Latin/digit subset), each run
/// drawn with a single doc.font() call. Each run's own characters are
/// left untouched (see the file-header comment) - only drawCell() reverses
/// the *array* of runs this returns, never a run's internal text. A code
/// point present in neither subset (rare - e.g. an unsupported symbol)
/// falls back to the Latin font, which pdfkit will simply skip/tofu
/// rather than throw on.
export function splitRuns(text: string): { font: string; text: string }[] {
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
export function drawCell(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, opts: { bold?: boolean; size?: number } = {}) {
  const size = opts.size ?? 9;
  doc.fontSize(size);
  // Reverse RUN order (visual RTL flow), never a run's own characters -
  // see the file-header comment for why. splitRuns() runs on the raw,
  // untouched `text` (not a pre-reversed string).
  const runs = splitRuns(text).reverse();

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

// --- Paragraph text -------------------------------------------------------
//
// drawCell() above is tuned for table cells, which are a word or two and a
// number: it reverses the order of font runs and nothing else. In running
// prose that rule shows its edges. Spaces and punctuation live in the
// Latin subset, so "1.1. אנקורה", "(שעון ישראל)" or "סודיות-1.0" put a
// neutral character on the wrong side of its neighbour. Changing drawCell
// would move every report's glyphs, which the tests pin by hand, so prose
// gets its own small resolver instead: a reduced Unicode bidi pass for an
// RTL paragraph that holds Hebrew, Latin letters, digits and punctuation.
//
//   1. Every character is strong RTL (Hebrew), strong LTR (any other
//      letter or digit), or neutral.
//   2. A neutral run takes the direction of its neighbours when both
//      sides agree, and the paragraph's (RTL) otherwise. The line's edges
//      count as RTL.
//   3. Visual order: LTR runs keep their characters, RTL runs are
//      reversed, and the sequence of runs is reversed. Brackets inside an
//      RTL run are mirrored, which is what makes "(שעון ישראל)" close on
//      the correct side.
//
// Three refinements came with the client file (17.10.2026), whose lines
// mix Hebrew with names like "NUX Inc" and amounts like "25,000$":
//
//   a. A bracket pair takes one direction for both brackets (UBA rule
//      N0): RTL when it holds Hebrew, LTR when it holds only Latin and
//      the text before it is Latin, RTL otherwise. "NUX (NUX.AI Ltd)" no
//      longer loses its closing bracket to the paragraph.
//   b. A currency or percent sign next to a digit is part of the number,
//      so "25,000$" stays together.
//   c. RIGHT-TO-LEFT MARK (U+200F) is strong RTL and is not drawn. A
//      caller puts it around a separator to keep two Latin details from
//      reading as one run ("Claude · 138").
//
// The visual string is then cut into font segments for drawing. A Hebrew
// segment is handed to pdfkit in LOGICAL order, because fontkit reverses
// any Hebrew-script text it is given (the header comment above records
// how that was established); every other segment is drawn as it stands.

type BidiClass = "R" | "L" | "N";

const RLM = "\u200F";
const NUMBER_SIGNS = /[$%₪€£°#+]/;
const OPEN_BRACKETS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

function bidiClass(ch: string): BidiClass {
  if (ch === RLM) return "R";
  if (HEBREW_RANGE.test(ch)) return "R";
  if (/[\p{L}\p{N}]/u.test(ch)) return "L";
  return "N";
}

const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<" };

/// Left-to-right drawing segments for one line of an RTL paragraph.
/// Exported for its unit test; drawBidiLine() is the only caller.
export function visualSegments(text: string): { font: string; text: string }[] {
  const chars = Array.from(text);
  const cls = chars.map(bidiClass);
  const isDigit = (i: number) => i >= 0 && i < chars.length && /\p{N}/u.test(chars[i]);

  // (b) A sign beside a number belongs to it.
  chars.forEach((ch, i) => {
    if (cls[i] === "N" && NUMBER_SIGNS.test(ch) && (isDigit(i - 1) || isDigit(i + 1))) cls[i] = "L";
  });

  // (a) Bracket pairs, innermost first, resolved before the neutrals.
  const stack: number[] = [];
  const pairs: [number, number][] = [];
  chars.forEach((ch, i) => {
    if (OPEN_BRACKETS[ch]) stack.push(i);
    else if (Object.values(OPEN_BRACKETS).includes(ch)) {
      const o = stack.length && OPEN_BRACKETS[chars[stack[stack.length - 1]]] === ch ? stack.pop()! : -1;
      if (o >= 0) pairs.push([o, i]);
    }
  });
  for (const [o, c] of pairs) {
    const inside = cls.slice(o + 1, c);
    let d: "R" | "L" | null = null;
    if (inside.includes("R")) d = "R";
    else if (inside.includes("L")) {
      let before: BidiClass = "R";
      for (let k = o - 1; k >= 0; k--) if (cls[k] !== "N") { before = cls[k]; break; }
      d = before === "L" ? "L" : "R";
    }
    if (d) cls[o] = cls[c] = d;
  }

  // Resolve neutrals.
  const dir: ("R" | "L")[] = new Array(chars.length);
  for (let i = 0; i < chars.length; ) {
    if (cls[i] !== "N") {
      dir[i] = cls[i] as "R" | "L";
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && cls[j] === "N") j++;
    const before = i > 0 ? dir[i - 1] : "R";
    const after = j < chars.length ? (cls[j] as "R" | "L") : "R";
    const resolved = before === after ? before : "R";
    for (let k = i; k < j; k++) dir[k] = resolved;
    i = j;
  }

  // Directional runs in logical order, then visual order.
  const runs: { dir: "R" | "L"; chars: string[] }[] = [];
  chars.forEach((ch, i) => {
    const last = runs[runs.length - 1];
    if (last && last.dir === dir[i]) last.chars.push(ch);
    else runs.push({ dir: dir[i], chars: [ch] });
  });
  const visual: string[] = [];
  for (const run of runs.reverse()) {
    if (run.dir === "L") visual.push(...run.chars);
    else visual.push(...run.chars.reverse().map((ch) => MIRROR[ch] ?? ch));
  }
  // (c) The mark has done its work; it has no glyph to draw.
  for (let i = visual.length - 1; i >= 0; i--) if (visual[i] === RLM) visual.splice(i, 1);

  // Font segments, left to right.
  const segments: { font: string; text: string }[] = [];
  for (const ch of visual) {
    const font = charFont(ch);
    const last = segments[segments.length - 1];
    if (last && last.font === font) last.text += ch;
    else segments.push({ font, text: ch });
  }
  return segments.map((seg) =>
    seg.font === HEBREW_FONT ? { font: seg.font, text: Array.from(seg.text).reverse().join("") } : seg
  );
}

/// One line of an RTL paragraph, right-aligned within [x, x+width].
export function drawBidiLine(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, size: number) {
  doc.fontSize(size);
  const segments = visualSegments(text);
  let total = 0;
  for (const seg of segments) {
    doc.font(seg.font);
    total += doc.widthOfString(seg.text);
  }
  let cursorX = x + width - total;
  for (const seg of segments) {
    doc.font(seg.font);
    doc.text(seg.text, cursorX, y, { lineBreak: false });
    cursorX += doc.widthOfString(seg.text);
  }
}

/// x positions for RTL columns: header[0] is the RIGHTMOST column on the page.
///
/// Exported only so the invariant below can be asserted directly - the drawing
/// path is the only caller.
///
/// Lays the slots out left-to-right using the REVERSED width order, then maps
/// each original column index onto its slot. The obvious version - walk the
/// un-reversed widths accumulating positions, then reverse that flat array -
/// pairs every column with another column's x as soon as the widths are not all
/// equal: column 0 lands at the start of a slot sized for the LAST column, and
/// only the outermost pair happens to line up.
///
/// Dormant today: no caller passes columnWeights, so every report has equal
/// columns and the two agree. Fixed, and pinned by a test, before the first
/// uneven report makes it visible. (Salvaged from PR #16, whose other two
/// fixes main had already landed independently.)
export function layoutRtlColumns(colWidths: number[], left: number): number[] {
  const slotX: number[] = [];
  let acc = left;
  for (const w of [...colWidths].reverse()) {
    slotX.push(acc);
    acc += w;
  }
  return colWidths.map((_, i) => slotX[colWidths.length - 1 - i]);
}

/// An A4 pdfkit document with both Heebo subsets registered. Shared by
/// the report tables below and by lib/agreement-pdf.ts, so the two
/// production lessons recorded here (the eager standard font, and the
/// .woff font files) are learned once.
export function createHebrewPdfDocument(): PDFKit.PDFDocument {
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
  return doc;
}

/// Total width of a mixed Hebrew/Latin string, measured run by run with
/// the font each run is drawn in. drawCell() right-aligns with exactly
/// this; a caller wrapping a paragraph needs the same number.
export function measureMixed(doc: PDFKit.PDFDocument, text: string, size: number): number {
  doc.fontSize(size);
  let total = 0;
  for (const run of splitRuns(text)) {
    doc.font(run.font);
    total += doc.widthOfString(run.text);
  }
  return total;
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
    const doc = createHebrewPdfDocument();

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const weights = opts.columnWeights ?? opts.headers.map(() => 1);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const colWidths = weights.map((w) => (w / weightSum) * pageWidth);
    const colX = layoutRtlColumns(colWidths, doc.page.margins.left);

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
