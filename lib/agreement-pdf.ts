import "server-only";
import { createHebrewPdfDocument, drawBidiLine, layoutRtlColumns, measureMixed } from "@/lib/pdf";
import { AGREEMENT_CHANNEL_LABEL, agreementBody, agreementCode, unescapeMarkdown } from "@/lib/agreements";
import type { AgreementChannel, AgreementKind } from "@prisma/client";

// The signed copy of an employee agreement: the text the person agreed
// to, followed by a block that says who, when, from where and over which
// exact text. It is a record of a signature that already happened in the
// database, not the signature itself, which is why it can be produced
// again later from the row and the versioned file if Drive was down.
//
// All drawing goes through lib/pdf.ts's helpers, which carry the Hebrew
// font lessons and the bidi pass for prose (drawBidiLine); this file only
// adds line wrapping, which a table of one-line cells never needed.

export interface AgreementPdfInput {
  kind: AgreementKind;
  title: string;
  version: string;
  /// The full file text. The body is extracted here, the same way the
  /// sign page extracts it, so the PDF and the screen never disagree.
  text: string;
  signedName: string;
  email: string;
  signedAt: Date;
  ip: string | null;
  userAgent: string | null;
  channel: AgreementChannel;
  contentHash: string;
}

const BODY_SIZE = 10;
const HEADING_SIZE = 12;
const LINE_GAP = 4;

function formatIsraelTime(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/// Greedy word wrap, measured with the fonts each character is drawn in.
/// A single word wider than the line (a user agent, a hash) is split by
/// characters, so nothing runs off the page.
function wrap(doc: PDFKit.PDFDocument, text: string, width: number, size: number): string[] {
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

/// Markdown body to drawable blocks. Only what the agreement files use:
/// section headings, bullets, bold markers and backslash escapes.
function toBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const clean = unescapeMarkdown(line.replace(/\*\*/g, ""));
    if (clean.startsWith("## ")) blocks.push({ kind: "heading", text: clean.slice(3) });
    else if (/^[-*]\s+/.test(clean)) blocks.push({ kind: "para", text: `• ${clean.replace(/^[-*]\s+/, "")}` });
    else blocks.push({ kind: "para", text: clean });
  }
  return blocks;
}

/// One document being written: the pdfkit doc, a cursor, and the few
/// drawing moves both agreement PDFs make. Pages are buffered so the
/// footer can be stamped on every page once the total is known.
function startDocument() {
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

type Block = { kind: "heading" | "para"; text: string } | { kind: "table"; rows: string[][] };

const FOOTER_SIZE = 7.5;

/// The whole source file as blocks for the blank form: preamble with its
/// fill-in lines, every section, and the tables as empty grids. Only the
/// "#" title is left out, because the page draws it.
function toFullBlocks(source: string): Block[] {
  const out: Block[] = [];
  let tableRows: string[][] | null = null;
  const flush = () => {
    if (tableRows && tableRows.length) out.push({ kind: "table", rows: tableRows });
    tableRows = null;
  };
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("|")) {
      // The separator row ("| --- | --- |"). Needs a hyphen: an empty data
      // row ("|  |  |") is a line to write in, not a separator.
      if (/^\|[\s|:]*-[\s|:-]*\|$/.test(line)) continue;
      const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((c) => clean(c.trim()));
      (tableRows ??= []).push(cells);
      continue;
    }
    flush();
    if (!line || line.startsWith("# ")) continue;
    const text = clean(line);
    if (text.startsWith("## ")) out.push({ kind: "heading", text: text.slice(3) });
    else if (/^[-*]\s+/.test(text)) out.push({ kind: "para", text: `• ${text.replace(/^[-*]\s+/, "")}` });
    else out.push({ kind: "para", text });
  }
  flush();
  return out;
}

/// Bold markers and escapes out; the ballot box (not in either Heebo
/// subset, so it would print as nothing) becomes "[ ]".
function clean(line: string): string {
  return unescapeMarkdown(line.replace(/\*\*/g, "")).replace(/\u2610/g, "[ ]");
}

/// The form a person signs on paper or digitally, sent by email for the
/// PDF channel: the full text with its blank lines, the returned-items
/// table where the document has one, and the signature table. The code
/// in the footer of every page is what an agent checks on the PDF that
/// comes back.
export function renderBlankAgreementPdf(input: { kind: AgreementKind; title: string; version: string; text: string }): Promise<Buffer> {
  const w = startDocument();
  drawBidiLine(w.doc, input.title, w.left, w.state.y, w.width, 16);
  w.state.y += 30;
  w.blocks(toFullBlocks(input.text));
  return w.finish(agreementCode(input.kind, input.version));
}

export function renderAgreementPdf(input: AgreementPdfInput): Promise<Buffer> {
  const w = startDocument();
  const { doc, left, width, state } = w;

  drawBidiLine(doc, input.title, left, state.y, width, 16);
  state.y += 26;
  drawBidiLine(doc, `גרסה: ${input.version}`, left, state.y, width, 10);
  state.y += 24;

  w.blocks(toBlocks(agreementBody(input.text)));

  // Signature block. Label in a fixed right-hand column and the value
  // beside it, rather than "label: value" on one line, so a long Latin
  // value (a browser string, the hash) wraps inside its own column.
  const rows: [string, string][] = [
    ["שם החותם", input.signedName],
    ["דוא\"ל", input.email],
    ["תאריך ושעה", `${formatIsraelTime(input.signedAt)} (שעון ישראל)`],
    ["כתובת IP", input.ip ?? "לא ידוע"],
    ["דפדפן", input.userAgent ?? "לא ידוע"],
    ["ערוץ", AGREEMENT_CHANNEL_LABEL[input.channel]],
    ["גרסה", input.version],
    ["גיבוב התוכן (SHA-256)", input.contentHash],
  ];

  state.y += 12;
  w.ensure(30 + rows.length * 18);
  doc.moveTo(left, state.y).lineTo(left + width, state.y).strokeColor("#999999").stroke();
  state.y += 10;
  drawBidiLine(doc, "פרטי החתימה", left, state.y, width, HEADING_SIZE);
  state.y += HEADING_SIZE + 10;

  const labelWidth = 130;
  const valueWidth = width - labelWidth - 10;
  for (const [label, value] of rows) {
    const lines = wrap(doc, value, valueWidth, BODY_SIZE);
    w.ensure(lines.length * (BODY_SIZE + LINE_GAP) + 4);
    drawBidiLine(doc, label, left + width - labelWidth, state.y, labelWidth, BODY_SIZE);
    for (const line of lines) {
      drawBidiLine(doc, line, left, state.y, valueWidth, BODY_SIZE);
      state.y += BODY_SIZE + LINE_GAP;
    }
    state.y += 4;
  }

  return w.finish(agreementCode(input.kind, input.version));
}
