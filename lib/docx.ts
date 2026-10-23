import JSZip from "jszip";

// A small Word (.docx) writer (23.10.2026), for documents that leave the
// product to be read, commented on and signed elsewhere: the procedure
// document first. jszip is already a dependency; a document library would
// be a second one for four kinds of block.
//
// What it writes is plain WordprocessingML: headings as Word's own
// Heading 1 and 2 styles (so the navigation pane and a table of contents
// work), real tables, a header and a footer with page numbers. A Hebrew
// document is right to left at the section, paragraph and table level,
// and every Hebrew run is marked as one, which is what Word needs to lay
// out a line that mixes Hebrew with "SOC 2" or "CC6.2" correctly.

export type DocxBlock =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "para"; text: string; muted?: boolean; small?: boolean; mono?: boolean }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][]; weights?: number[] }
  | { kind: "pageBreak" };

export type DocxInput = {
  dir: "rtl" | "ltr";
  lang: "he" | "en";
  title: string;
  /// Top of every page, at the outer edge.
  header: string;
  /// Bottom of every page; "page N of M" is added after it.
  footer: string;
  blocks: DocxBlock[];
};

const FONT = "Arial";
const MUTED = "5B6472";
const BORDER = "C9CED6";
const HEADER_FILL = "EEF0F3";
/// A4 at 2 cm margins, in twentieths of a point.
const PAGE = { w: 11906, h: 16838, margin: 1134 };
const TEXT_WIDTH = PAGE.w - 2 * PAGE.margin;

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters XML 1.0 does not allow at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

const HEBREW = /[֐-׿יִ-ﭏ]/;

/// Text split into runs Word can lay out: a Hebrew run is marked right to
/// left; spaces and punctuation join the run before them.
export function scriptRuns(text: string): { text: string; rtl: boolean }[] {
  const runs: { text: string; rtl: boolean }[] = [];
  for (const ch of Array.from(text)) {
    const strong = HEBREW.test(ch) ? true : /[\p{L}\p{N}]/u.test(ch) ? false : null;
    const last = runs[runs.length - 1];
    if (!last) runs.push({ text: ch, rtl: strong ?? false });
    else if (strong === null || strong === last.rtl) last.text += ch;
    else runs.push({ text: ch, rtl: strong });
  }
  return runs;
}

type RunStyle = { size?: number; color?: string; bold?: boolean; mono?: boolean };

function runs(text: string, style: RunStyle = {}): string {
  const size = style.size ? `<w:sz w:val="${style.size * 2}"/><w:szCs w:val="${style.size * 2}"/>` : "";
  const color = style.color ? `<w:color w:val="${style.color}"/>` : "";
  const bold = style.bold ? "<w:b/><w:bCs/>" : "";
  const font = style.mono ? `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>` : "";
  return scriptRuns(text)
    .map((r) => `<w:r><w:rPr>${font}${bold}${color}${size}${r.rtl ? "<w:rtl/>" : ""}</w:rPr><w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`)
    .join("");
}

function para(input: DocxInput, text: string, opts: { style?: string; run?: RunStyle; spacingAfter?: number; indent?: number; keepNext?: boolean; pageBreakBefore?: boolean } = {}): string {
  const bidi = input.dir === "rtl" ? "<w:bidi/>" : "";
  const style = opts.style ? `<w:pStyle w:val="${opts.style}"/>` : "";
  const keep = opts.keepNext ? "<w:keepNext/>" : "";
  const brk = opts.pageBreakBefore ? "<w:pageBreakBefore/>" : "";
  const spacing = opts.spacingAfter !== undefined ? `<w:spacing w:after="${opts.spacingAfter}"/>` : "";
  // "start" is the reading side in both directions once w:bidi is set.
  const ind = opts.indent ? `<w:ind w:start="${opts.indent}" w:hanging="220"/>` : "";
  return `<w:p><w:pPr>${style}${keep}${brk}${bidi}${spacing}${ind}</w:pPr>${runs(text, opts.run)}</w:p>`;
}

function table(input: DocxInput, header: string[], rows: string[][], weights?: number[]): string {
  const all = header.length ? [header, ...rows] : rows;
  const cols = Math.max(1, ...all.map((r) => r.length));
  const w = weights && weights.length === cols ? weights : Array.from({ length: cols }, () => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  const widths = w.map((x) => Math.floor((x / sum) * TEXT_WIDTH));
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${BORDER}"/>`;
  const tblPr =
    `<w:tblPr>${input.dir === "rtl" ? "<w:bidiVisual/>" : ""}<w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/>` +
    `<w:tblBorders>${["top", "start", "bottom", "end", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:start w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:end w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const grid = `<w:tblGrid>${widths.map((x) => `<w:gridCol w:w="${x}"/>`).join("")}</w:tblGrid>`;
  const body = all
    .map((row, r) => {
      const isHeader = header.length > 0 && r === 0;
      const cells = widths
        .map((cw, i) => {
          const shade = isHeader ? `<w:shd w:val="clear" w:color="auto" w:fill="${HEADER_FILL}"/>` : "";
          const lines = (row[i] ?? "").split(/\n/);
          const ps = lines.map((l) => para(input, l, { spacingAfter: 0, run: { size: 10, bold: isHeader } })).join("");
          return `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>${shade}</w:tcPr>${ps}</w:tc>`;
        })
        .join("");
      const trPr = isHeader ? "<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>" : "<w:trPr><w:cantSplit/></w:trPr>";
      return `<w:tr>${trPr}${cells}</w:tr>`;
    })
    .join("");
  // A paragraph after every table: Word merges two adjacent tables.
  return `<w:tbl>${tblPr}${grid}${body}</w:tbl>${para(input, "", { spacingAfter: 60 })}`;
}

function bodyXml(input: DocxInput): string {
  let pendingBreak = false;
  const out: string[] = [];
  for (const b of input.blocks) {
    const brk = pendingBreak;
    pendingBreak = false;
    switch (b.kind) {
      case "pageBreak":
        pendingBreak = true;
        break;
      case "title":
        out.push(para(input, b.text, { style: "Title", pageBreakBefore: brk }));
        break;
      case "subtitle":
        out.push(para(input, b.text, { style: "Subtitle", pageBreakBefore: brk }));
        break;
      case "heading":
        out.push(para(input, b.text, { style: b.level === 1 ? "Heading1" : "Heading2", keepNext: true, pageBreakBefore: brk }));
        break;
      case "para":
        out.push(para(input, b.text, { pageBreakBefore: brk, run: { color: b.muted ? MUTED : undefined, size: b.small ? 8 : undefined, mono: b.mono } }));
        break;
      case "bullets":
        b.items.forEach((item, i) => out.push(para(input, `• ${item}`, { indent: 440, spacingAfter: 40, pageBreakBefore: brk && i === 0 })));
        break;
      case "table":
        if (brk) out.push(para(input, "", { pageBreakBefore: true, spacingAfter: 0 }));
        out.push(table(input, b.header, b.rows, b.weights));
        break;
    }
  }
  const sectBidi = input.dir === "rtl" ? "<w:bidi/>" : "";
  const sect =
    `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>` +
    `<w:pgSz w:w="${PAGE.w}" w:h="${PAGE.h}"/><w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="567" w:footer="567" w:gutter="0"/>${sectBidi}</w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${out.join("")}${sect}</w:body></w:document>`;
}

function field(input: DocxInput, instr: string): string {
  const rtl = input.dir === "rtl" ? "<w:rtl/>" : "";
  const rpr = `<w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/><w:szCs w:val="16"/>${rtl}</w:rPr>`;
  return `<w:r>${rpr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rpr}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r>${rpr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rpr}<w:t>1</w:t></w:r><w:r>${rpr}<w:fldChar w:fldCharType="end"/></w:r>`;
}

function headerXml(input: DocxInput): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:pPr>${input.dir === "rtl" ? "<w:bidi/>" : ""}<w:jc w:val="end"/></w:pPr>${runs(input.header, { size: 8, color: MUTED })}</w:p></w:hdr>`;
}

function footerXml(input: DocxInput): string {
  const words = input.lang === "he" ? { page: "עמוד", of: "מתוך" } : { page: "Page", of: "of" };
  const sep = runs(" · ", { size: 8, color: MUTED });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:pPr>${input.dir === "rtl" ? "<w:bidi/>" : ""}<w:jc w:val="center"/></w:pPr>${runs(input.footer, { size: 8, color: MUTED })}${sep}${runs(`${words.page} `, { size: 8, color: MUTED })}${field(input, "PAGE")}${runs(` ${words.of} `, { size: 8, color: MUTED })}${field(input, "NUMPAGES")}</w:p></w:ftr>`;
}

function stylesXml(input: DocxInput): string {
  const lang = input.lang === "he" ? `<w:lang w:val="he-IL" w:bidi="he-IL"/>` : `<w:lang w:val="en-US"/>`;
  const heading = (id: string, name: string, size: number, before: number, after: number, color = "111827") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="${after}"/>${id.startsWith("Heading") ? `<w:outlineLvl w:val="${id === "Heading1" ? 0 : 1}"/>` : ""}${id === "Heading1" ? `<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="${BORDER}"/></w:pBdr>` : ""}</w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:color w:val="${color}"/><w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/><w:sz w:val="21"/><w:szCs w:val="21"/>${lang}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading("Title", "Title", 22, 0, 60)}
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
${heading("Heading1", "heading 1", 13, 320, 120)}
${heading("Heading2", "heading 2", 11, 200, 80, "1F2937")}
</w:styles>`;
}

export async function renderDocx(input: DocxInput): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(input.title)}</dc:title><dc:creator>Ankora</dc:creator><dc:language>${input.lang === "he" ? "he-IL" : "en-US"}</dc:language></cp:coreProperties>`
  );
  zip.file("word/document.xml", bodyXml(input));
  zip.file("word/styles.xml", stylesXml(input));
  zip.file("word/header1.xml", headerXml(input));
  zip.file("word/footer1.xml", footerXml(input));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
