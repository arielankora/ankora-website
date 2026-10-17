import "server-only";
import { createHebrewPdfDocument, drawBidiLine, layoutRtlColumns, measureMixed } from "@/lib/pdf";

// A flowing Hebrew document on top of lib/pdf.ts: wrapped paragraphs,
// headings, bordered tables, page breaks and a footer on every page.
// Moved here from lib/agreement-pdf.ts when the client file became the
// second document drawn this way, so both learn the same lessons once.

export const BODY_SIZE = 10;
export const HEADING_SIZE = 12;
export const LINE_GAP = 4;

/// Greedy word wrap, measured with the fonts each character is drawn in.
/// A single word wider than the line (a user agent, a hash) is split by
/// characters, so nothing runs off the page.
export function wrap(doc: PDFKit.PDFDocument, text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  let current = "";
  const fits = (s: string) => measureMixed(doc, s, size) <= width;

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (fits(word)) {
      current = word;
      continue;
    }
    let piece = "";
    for (const ch of word) {
      if (fits(piece + ch)) piece += ch;
      else {
        lines.push(piece);
        piece = ch;
      }
    }
    current = piece;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/// One document being written: the pdfkit doc, a cursor, and the few
/// drawing moves every flowing PDF makes. Pages are buffered so the
/// footer can be stamped on every page once the total is known.
export function startDocument() {
  const doc = createHebrewPdfDocument();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const state = { y: doc.page.margins.top };
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  function ensure(height: number) {
    if (state.y + height > bottom()) {
      doc.addPage();
      state.y = doc.page.margins.top;
    }
  }

  function paragraph(text: string, size: number, x = left, w = width) {
    for (const line of wrap(doc, text, w, size)) {
      ensure(size + LINE_GAP);
      drawBidiLine(doc, line, x, state.y, w, size);
      state.y += size + LINE_GAP;
    }
  }

  function blocks(list: Block[]) {
    for (const block of list) {
      if (block.kind === "heading") {
        state.y += 6;
        ensure(HEADING_SIZE + LINE_GAP + BODY_SIZE * 2);
        paragraph(block.text, HEADING_SIZE);
        state.y += 2;
      } else if (block.kind === "table") {
        table(block.rows);
      } else {
        paragraph(block.text, BODY_SIZE);
        state.y += 4;
      }
    }
  }

  /// A bordered table, first column on the right. Empty rows keep a
  /// height a hand can write in.
  function table(rows: string[][]) {
    const columns = Math.max(...rows.map((r) => r.length));
    const widths = Array.from({ length: columns }, () => width / columns);
    const xs = layoutRtlColumns(widths, left);
    state.y += 4;
    const laid = rows.map((row) => {
      const cellLines = widths.map((w, i) => (row[i] ? wrap(doc, row[i], w - 8, BODY_SIZE) : []));
      return { cellLines, height: Math.max(24, ...cellLines.map((l) => l.length * (BODY_SIZE + LINE_GAP) + 10)) };
    });
    // A signature table split across two pages leaves its header on one
    // and the lines to sign on the other; keep a table that fits on one
    // page together.
    const total = laid.reduce((sum, r) => sum + r.height, 0);
    if (total < doc.page.height - doc.page.margins.top - doc.page.margins.bottom) ensure(total);
    for (const { cellLines, height } of laid) {
      ensure(height);
      widths.forEach((w, i) => {
        doc.rect(xs[i], state.y, w, height).strokeColor("#999999").stroke();
        cellLines[i].forEach((line, n) => drawBidiLine(doc, line, xs[i] + 4, state.y + 6 + n * (BODY_SIZE + LINE_GAP), w - 8, BODY_SIZE));
      });
      state.y += height;
    }
    state.y += 10;
  }

  /// "ANKORA-CONF-1.0 · page 2/4", centred under every page, in the Latin
  /// font only, so text extraction returns it exactly as printed.
  function finish(code: string) {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // The footer sits inside the bottom margin; without this pdfkit
      // would treat it as overflow and open a page for it.
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const text = `${code} · page ${i + 1}/${range.count}`;
      const w = measureMixed(doc, text, FOOTER_SIZE);
      drawBidiLine(doc, text, left + (width - w) / 2, doc.page.height - 26, w, FOOTER_SIZE);
      doc.page.margins.bottom = margin;
    }
    doc.end();
    return done;
  }

  return { doc, left, width, state, ensure, paragraph, blocks, finish };
}

export type Block = { kind: "heading" | "para"; text: string } | { kind: "table"; rows: string[][] };

const FOOTER_SIZE = 7.5;
