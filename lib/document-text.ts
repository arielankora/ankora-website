import ExcelJS from "exceljs";
import JSZip from "jszip";

// MCP document reading (12.10.2026): a document's bytes as text a model can
// read.
//
// read_document hands Claude the content of a file in the client's file, so
// a signed form, a quote or a policy can be context for advancing a task.
// Most of what is filed here is PDF, Word or Excel. A model cannot read
// those formats from a tool result, and base64 of a 2MB PDF would be
// hundreds of thousands of tokens of noise, so the server extracts the text
// and returns that. What cannot be extracted (a scanned PDF with no text
// layer, a photo) comes back as an image when it is one, and otherwise as
// an honest "no text" with the download address next to it.
//
// No `server-only` and no Prisma, so tests/unit/document-text.test.ts runs
// it on real files built in the test.

/// Text returned in one tool result. Roughly 30k tokens of Hebrew: enough
/// for a contract, and a ceiling on what one careless call can cost.
export const MAX_DOCUMENT_TEXT_CHARS = 60_000;

export type ExtractedText =
  | { kind: "text"; text: string; truncated: boolean; pages?: number }
  | { kind: "image" }
  | { kind: "none"; reason: string };

const TEXT_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
]);

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function clipText(text: string, max = MAX_DOCUMENT_TEXT_CHARS): { text: string; truncated: boolean } {
  const t = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? { text: t.slice(0, max).trimEnd(), truncated: true } : { text: t, truncated: false };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/// WordprocessingML to plain text: one line per paragraph, tabs and breaks
/// kept, table cells separated by " | ". Good enough to read a contract; the
/// layout is not the point.
export function wordXmlToText(xml: string): string {
  const body = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(br|cr)\/>/g, "\n")
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n");
  const text = body.replace(/<[^>]+>/g, "");
  return decodeXmlEntities(text)
    .split("\n")
    .map((l) => l.replace(/\s*\|\s*$/, "").trimEnd())
    .join("\n");
}

async function docxText(content: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(content);
  const parts = ["word/document.xml", ...Object.keys(zip.files).filter((n) => /^word\/(header|footer|footnotes)\d*\.xml$/.test(n))];
  const out: string[] = [];
  for (const name of parts) {
    const file = zip.file(name);
    if (file) out.push(wordXmlToText(await file.async("string")));
  }
  return out.join("\n\n");
}

async function pptxText(content: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(content);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  for (const [i, name] of slides.entries()) {
    const xml = await zip.file(name)!.async("string");
    const text = decodeXmlEntities(xml.replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, "")).trim();
    out.push(`[שקף ${i + 1}]\n${text}`);
  }
  return out.join("\n\n");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String(value.text);
    if ("error" in value) return String(value.error);
    return "";
  }
  return String(value);
}

async function xlsxText(content: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  // exceljs types predate Node's generic Buffer; the bytes are what it wants.
  await wb.xlsx.load(content as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet((sheet) => {
    out.push(`[גיליון: ${sheet.name}]`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
      while (values.length && values[values.length - 1] === "") values.pop();
      out.push(values.join("\t"));
    });
    out.push("");
  });
  return out.join("\n");
}

async function pdfText(content: Buffer): Promise<{ text: string; pages: number }> {
  // Loaded on demand: pdf.js is large, and most calls never need it.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(content));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => `[עמוד ${i + 1}]\n${t.trim()}`);
  return { text: pages.join("\n\n"), pages: totalPages };
}

/// The readable text of a document, by its MIME type (and file name, for
/// the types browsers report as application/octet-stream).
export async function extractDocumentText(content: Buffer, mimeType: string, fileName = ""): Promise<ExtractedText> {
  const type = mimeType.toLowerCase();
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  try {
    if (type.startsWith("image/")) return { kind: "image" };

    if (type === "application/pdf" || ext === "pdf") {
      const { text, pages } = await pdfText(content);
      // A scan: pages, and almost no characters on them.
      if (text.replace(/\[עמוד \d+\]|\s/g, "").length < 20 * Math.max(1, pages)) {
        return {
          kind: "none",
          reason: "This PDF has no text layer (it is probably a scan), so Ankora cannot extract its text.",
        };
      }
      return { kind: "text", ...clipText(text), pages };
    }

    let text: string | null = null;
    if (type === DOCX || ext === "docx") text = await docxText(content);
    else if (type === XLSX || ext === "xlsx") text = await xlsxText(content);
    else if (type === PPTX || ext === "pptx") text = await pptxText(content);
    else if (TEXT_TYPES.has(type) || type.startsWith("text/") || ["txt", "csv", "md", "json"].includes(ext)) {
      text = content.toString("utf8");
    }

    if (text === null) {
      return { kind: "none", reason: `Ankora cannot extract text from this file type (${mimeType}).` };
    }
    if (!text.trim()) return { kind: "none", reason: "The file contains no text." };
    return { kind: "text", ...clipText(text) };
  } catch {
    return { kind: "none", reason: "Ankora could not read this file's contents; it may be damaged or password protected." };
  }
}
