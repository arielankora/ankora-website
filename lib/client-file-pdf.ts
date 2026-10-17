import "server-only";
import { drawBidiLine } from "@/lib/pdf";
import { startDocument, type Block } from "@/lib/pdf-flow";
import { HOW_TO_READ, itemLine, type ClientFileDoc } from "@/lib/client-file-document";

// The client file as a PDF (claude/org-brain-spec-2026-10-12.md, 6.1): the
// same document the read view draws and the Markdown writes, page by
// page, for whoever prefers to read it printed or to send it on. Every
// line is itemLine(), so a status, a source or a "do not tell" travels
// exactly as it does in the Markdown. An empty section is one line, as on
// the screen (decision 7).

/// Markdown out, and a right-to-left mark on each side of the separator
/// between details, so two English details never read as one ("Claude ·
/// 138"). The mark is not drawn (lib/pdf.ts, visualSegments).
const plain = (s: string) =>
  s
    .replace(/\*\*/g, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/ · /g, " \u200F·\u200F ");

function dateLabel(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" }).format(d);
}

/// The document as drawable blocks. Exported for its test: what is in the
/// PDF is decided here, and the drawing only lays it out.
export function clientFileBlocks(doc: ClientFileDoc): Block[] {
  const out: Block[] = [];
  out.push({ kind: "para", text: `הופק ב-${dateLabel(doc.generatedAt)}${doc.audience === "ai" ? ". גרסה ל-Claude: בלי פרטי קשר ובלי פריטים רגישים." : "."}` });
  if (doc.control?.length) out.push({ kind: "para", text: plain(`בקרה: ${doc.control.map((p) => p.text).join(" · ")}`) });
  out.push({ kind: "heading", text: "איך לקרוא את התיק" });
  out.push({ kind: "para", text: HOW_TO_READ });
  for (const s of doc.sections) {
    const title = `${s.number ? `${s.number}. ` : ""}${s.title}`;
    if (s.items.length === 0) {
      out.push({ kind: "para", text: `${title}: ${s.empty}` });
      continue;
    }
    out.push({ kind: "heading", text: title });
    const ungrouped = s.items.filter((i) => !i.group);
    const groups = [...new Set(s.items.filter((i) => i.group).map((i) => i.group!))];
    for (const i of ungrouped) out.push({ kind: "para", text: `• ${plain(itemLine(i))}` });
    for (const g of groups) {
      if (ungrouped.length || groups.length > 1) out.push({ kind: "para", text: `${g}:` });
      for (const i of s.items.filter((x) => x.group === g)) out.push({ kind: "para", text: `• ${plain(itemLine(i))}` });
    }
  }
  out.push({ kind: "heading", text: "מקרא מקורות" });
  if (doc.legend.length === 0) out.push({ kind: "para", text: "אין עדיין מקורות במרשם." });
  for (const l of doc.legend) out.push({ kind: "para", text: `${l.code}: ${plain(l.title)}${l.details ? ` (${l.details})` : ""}` });
  return out;
}

export function renderClientFilePdf(doc: ClientFileDoc): Promise<Buffer> {
  const w = startDocument();
  drawBidiLine(w.doc, `תיק לקוח: ${doc.clientName}`, w.left, w.state.y, w.width, 16);
  w.state.y += 26;
  w.blocks(clientFileBlocks(doc));
  return w.finish("ANKORA CLIENT FILE");
}
