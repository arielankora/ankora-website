import "server-only";
import { createHebrewPdfDocument, drawBidiLine, measureMixed } from "@/lib/pdf";
import { AGREEMENT_CHANNEL_LABEL, agreementBody, unescapeMarkdown } from "@/lib/agreements";
import type { AgreementChannel } from "@prisma/client";

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
function toBlocks(body: string): { kind: "heading" | "para"; text: string }[] {
  const blocks: { kind: "heading" | "para"; text: string }[] = [];
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

export function renderAgreementPdf(input: AgreementPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = createHebrewPdfDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    let y = doc.page.margins.top;

    function ensure(height: number) {
      if (y + height > bottom()) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    }

    function paragraph(text: string, size: number, x = left, w = width) {
      for (const line of wrap(doc, text, w, size)) {
        ensure(size + LINE_GAP);
        drawBidiLine(doc, line, x, y, w, size);
        y += size + LINE_GAP;
      }
    }

    drawBidiLine(doc, input.title, left, y, width, 16);
    y += 26;
    drawBidiLine(doc, `גרסה: ${input.version}`, left, y, width, 10);
    y += 24;

    for (const block of toBlocks(agreementBody(input.text))) {
      if (block.kind === "heading") {
        y += 6;
        ensure(HEADING_SIZE + LINE_GAP + BODY_SIZE * 2);
        paragraph(block.text, HEADING_SIZE);
        y += 2;
      } else {
        paragraph(block.text, BODY_SIZE);
        y += 4;
      }
    }

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

    y += 12;
    ensure(30 + rows.length * 18);
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .strokeColor("#999999")
      .stroke();
    y += 10;
    drawBidiLine(doc, "פרטי החתימה", left, y, width, HEADING_SIZE);
    y += HEADING_SIZE + 10;

    const labelWidth = 130;
    const valueWidth = width - labelWidth - 10;
    for (const [label, value] of rows) {
      const lines = wrap(doc, value, valueWidth, BODY_SIZE);
      ensure(lines.length * (BODY_SIZE + LINE_GAP) + 4);
      drawBidiLine(doc, label, left + width - labelWidth, y, labelWidth, BODY_SIZE);
      for (const line of lines) {
        drawBidiLine(doc, line, left, y, valueWidth, BODY_SIZE);
        y += BODY_SIZE + LINE_GAP;
      }
      y += 4;
    }

    doc.end();
  });
}
