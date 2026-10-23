import "server-only";
import { renderDocx, type DocxBlock } from "@/lib/docx";
import { dateText, fingerprintBlock, labels, type DocBlock, type ProcedureDoc, type ProcedureLang } from "@/lib/procedure-document";

// A procedure document as a Word file (23.10.2026), and a client's
// procedures as one Word file. The same blocks the PDF and the screen
// draw (lib/procedure-document.ts).

function body(doc: ProcedureDoc, fingerprint: string): DocxBlock[] {
  const t = labels(doc.lang);
  const meta = doc.meta.filter(([, v]) => v);
  const rows: string[][] = [];
  for (let i = 0; i < meta.length; i += 2) rows.push([meta[i][0], meta[i][1], meta[i + 1]?.[0] ?? "", meta[i + 1]?.[1] ?? ""]);
  const out: DocxBlock[] = [
    { kind: "subtitle", text: doc.clientName },
    { kind: "title", text: doc.title },
    { kind: "para", text: `${doc.docId} · ${t.version} ${doc.version}`, muted: true },
    { kind: "table", header: [], rows, weights: [1, 1.5, 1, 1.5] },
  ];
  if (doc.liveNote) out.push({ kind: "para", text: doc.liveNote, muted: true, small: true });
  const map = (b: DocBlock): DocxBlock => (b.kind === "para" ? { kind: "para", text: b.text, muted: b.muted } : b);
  out.push(...doc.blocks.map(map));
  const [label, hash] = fingerprintBlock(doc, fingerprint);
  if (label.kind === "para" && hash.kind === "para") {
    out.push({ kind: "para", text: label.text, muted: true, small: true }, { kind: "para", text: hash.text, muted: true, small: true, mono: true });
  }
  return out;
}

export function renderProcedureDocx(doc: ProcedureDoc, fingerprint: string): Promise<Buffer> {
  return renderDocx({
    dir: doc.dir,
    lang: doc.lang,
    title: `${doc.docId} ${doc.title}`,
    header: `${doc.docId} v${doc.version} · ${doc.title}`,
    footer: doc.footer,
    blocks: body(doc, fingerprint),
  });
}

const PACK = {
  he: { title: "נהלים", generated: "הופק ב-", contents: "תוכן", header: ["מזהה", "נוהל", "גרסה", "בתוקף מ-"], skipped: "לא נכללו" },
  en: { title: "Procedures", generated: "Generated on ", contents: "Contents", header: ["ID", "Procedure", "Version", "Effective"], skipped: "Not included" },
};

export function renderProcedurePackDocx(pack: {
  clientName: string;
  lang: ProcedureLang;
  generatedAt: Date;
  docs: { doc: ProcedureDoc; fingerprint: string }[];
  skipped: { code: string; title: string; reason: string }[];
}): Promise<Buffer> {
  const t = PACK[pack.lang];
  const effective = labels(pack.lang).effective;
  const blocks: DocxBlock[] = [
    { kind: "subtitle", text: pack.clientName },
    { kind: "title", text: t.title },
    { kind: "para", text: `${t.generated}${dateText(pack.generatedAt, pack.lang)}`, muted: true },
    { kind: "heading", level: 1, text: t.contents },
    {
      kind: "table",
      header: t.header,
      rows: pack.docs.map(({ doc }) => [doc.docId, doc.title, String(doc.version), doc.meta.find(([k]) => k === effective)?.[1] ?? ""]),
      weights: [0.6, 3, 0.7, 1.2],
    },
  ];
  if (pack.skipped.length) blocks.push({ kind: "para", text: `${t.skipped}:`, muted: true }, { kind: "bullets", items: pack.skipped.map((s) => `${s.code} ${s.title}: ${s.reason}`) });
  for (const { doc, fingerprint } of pack.docs) blocks.push({ kind: "pageBreak" }, ...body(doc, fingerprint));
  return renderDocx({
    dir: pack.lang === "he" ? "rtl" : "ltr",
    lang: pack.lang,
    title: `${pack.clientName} ${t.title}`,
    header: `${pack.clientName} · ${t.title}`,
    footer: `${pack.clientName} · ${t.title}`,
    blocks,
  });
}
