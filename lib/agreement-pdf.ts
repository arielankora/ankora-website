import "server-only";
import { drawBidiLine } from "@/lib/pdf";
import { BODY_SIZE, HEADING_SIZE, LINE_GAP, startDocument, wrap, type Block } from "@/lib/pdf-flow";
import { AGREEMENT_CHANNEL_LABEL, agreementBody, agreementCode, unescapeMarkdown } from "@/lib/agreements";
import type { AgreementChannel, AgreementKind } from "@prisma/client";

// The signed copy of an employee agreement: the text the person agreed
// to, followed by a block that says who, when, from where and over which
// exact text. It is a record of a signature that already happened in the
// database, not the signature itself, which is why it can be produced
// again later from the row and the versioned file if Drive was down.
//
// All drawing goes through lib/pdf.ts's helpers, which carry the Hebrew
// font lessons and the bidi pass for prose (drawBidiLine), and through
// lib/pdf-flow.ts for wrapping, page breaks and the footer.

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
