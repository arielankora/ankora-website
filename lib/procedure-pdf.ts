import "server-only";
import { startDocument, BODY_SIZE } from "@/lib/pdf-flow";
import { dateText, fingerprintBlock, labels, type DocBlock, type ProcedureDoc, type ProcedureLang } from "@/lib/procedure-document";

// A procedure document as a PDF (23.10.2026), and a client's procedures
// as one PDF for an auditor. Draws the blocks lib/procedure-document.ts
// builds, nothing else, so the file says what the screen says.

const MUTED = "#5B6472";
const RULE = "#C9CED6";

type Writer = ReturnType<typeof startDocument>;

function drawBlocks(w: Writer, blocks: DocBlock[]) {
  for (const b of blocks) {
    if (b.kind === "heading") {
      if (b.level === 1) {
        w.state.y += 10;
        // A heading never ends a page: keep room for it and the start of
        // what follows (a table row is about 24 points).
        w.ensure(13 + 70);
        w.paragraph(b.text, 13);
        w.doc.moveTo(w.left, w.state.y).lineTo(w.left + w.width, w.state.y).strokeColor(RULE).lineWidth(0.6).stroke();
        w.state.y += 6;
      } else {
        w.state.y += 4;
        w.ensure(11 + 60);
        w.paragraph(b.text, 11);
        w.state.y += 1;
      }
    } else if (b.kind === "para") {
      w.paragraph(b.text, BODY_SIZE, w.left, w.width, b.muted ? MUTED : undefined);
      w.state.y += 3;
    } else if (b.kind === "bullets") {
      const indent = 12;
      for (const item of b.items) {
        // The bullet sits on the reading side: right in Hebrew, left in English.
        const x = w.dir === "rtl" ? w.left : w.left + indent;
        w.paragraph(`• ${item}`, BODY_SIZE, x, w.width - indent);
      }
      w.state.y += 3;
    } else {
      const rows = b.header.length ? [b.header, ...b.rows] : b.rows;
      w.table(rows, { weights: b.weights, header: b.header.length > 0 });
    }
  }
}

function drawDocument(w: Writer, doc: ProcedureDoc, fingerprint: string) {
  w.paragraph(doc.clientName, 10, w.left, w.width, MUTED);
  w.state.y += 2;
  w.paragraph(doc.title, 18);
  w.state.y += 2;
  w.paragraph(`${doc.docId} · ${labels(doc.lang).version} ${doc.version}`, 10, w.left, w.width, MUTED);
  w.state.y += 8;
  // The header as a four-column table: label, value, label, value.
  const meta = doc.meta.filter(([, v]) => v);
  const rows: string[][] = [];
  for (let i = 0; i < meta.length; i += 2) rows.push([meta[i][0], meta[i][1], meta[i + 1]?.[0] ?? "", meta[i + 1]?.[1] ?? ""]);
  w.table(rows, { weights: [1, 1.5, 1, 1.5] });
  if (doc.liveNote) {
    w.paragraph(doc.liveNote, 8.5, w.left, w.width, MUTED);
    w.state.y += 4;
  }
  drawBlocks(w, doc.blocks);
  drawBlocks(w, fingerprintBlock(doc, fingerprint));
}

export function renderProcedurePdf(doc: ProcedureDoc, fingerprint: string): Promise<Buffer> {
  const w = startDocument({ dir: doc.dir });
  drawDocument(w, doc, fingerprint);
  return w.finish(doc.footer);
}

const PACK = {
  he: { title: "נהלים", generated: "הופק ב-", contents: "תוכן", header: ["מזהה", "נוהל", "גרסה", "בתוקף מ-"], skipped: "לא נכללו:" },
  en: { title: "Procedures", generated: "Generated on ", contents: "Contents", header: ["ID", "Procedure", "Version", "Effective"], skipped: "Not included:" },
};

/// Every procedure in one file: a cover with the contents, then each
/// procedure from a new page.
export function renderProcedurePackPdf(
  pack: { clientName: string; lang: ProcedureLang; generatedAt: Date; docs: { doc: ProcedureDoc; fingerprint: string }[]; skipped: { code: string; title: string; reason: string }[] }
): Promise<Buffer> {
  const t = PACK[pack.lang];
  const w = startDocument({ dir: pack.lang === "he" ? "rtl" : "ltr" });
  w.state.y += 120;
  w.paragraph(pack.clientName, 14, w.left, w.width, MUTED);
  w.state.y += 4;
  w.paragraph(t.title, 26);
  w.state.y += 6;
  w.paragraph(`${t.generated}${dateText(pack.generatedAt, pack.lang)}`, 10, w.left, w.width, MUTED);
  w.state.y += 30;
  w.paragraph(t.contents, 13);
  w.state.y += 4;
  w.table(
    [
      t.header,
      ...pack.docs.map(({ doc }) => [doc.docId, doc.title, String(doc.version), doc.meta.find(([k]) => k === labels(pack.lang).effective)?.[1] ?? ""]),
    ],
    { weights: [0.6, 3, 0.7, 1.2], header: true }
  );
  if (pack.skipped.length) {
    w.paragraph(t.skipped, BODY_SIZE, w.left, w.width, MUTED);
    for (const s of pack.skipped) w.paragraph(`• ${s.code} ${s.title}: ${s.reason}`, BODY_SIZE, w.left, w.width, MUTED);
  }
  for (const { doc, fingerprint } of pack.docs) {
    w.doc.addPage();
    w.state.y = w.doc.page.margins.top;
    drawDocument(w, doc, fingerprint);
  }
  return w.finish(`${pack.clientName} · ${t.title}`);
}
