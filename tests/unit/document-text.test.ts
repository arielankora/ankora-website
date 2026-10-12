import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { MAX_DOCUMENT_TEXT_CHARS, clipText, extractDocumentText, wordXmlToText } from "@/lib/document-text";

// MCP document reading (12.10.2026). read_document returns a file's text,
// because a model cannot read a PDF or a Word file out of a tool result.
// Each format is built here for real, so these tests break if a library
// update changes what comes out.

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function docx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function pdf(pages: string[]): Promise<Buffer> {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise((r) => doc.on("end", r));
  pages.forEach((t, i) => {
    if (i > 0) doc.addPage();
    if (t) doc.text(t);
  });
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

describe("extractDocumentText", () => {
  it("reads a Word file, paragraph by paragraph", async () => {
    const r = await extractDocumentText(await docx(["Employment agreement", "Signed by both parties &amp; dated"]), DOCX);
    expect(r).toMatchObject({ kind: "text", truncated: false });
    if (r.kind === "text") expect(r.text).toBe("Employment agreement\nSigned by both parties & dated");
  });

  it("reads a Word file filed as octet-stream, by its extension", async () => {
    const r = await extractDocumentText(await docx(["x"]), "application/octet-stream", "a.docx");
    expect(r.kind).toBe("text");
  });

  it("reads every sheet of an Excel file", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("הצעה").addRows([
      ["ספק", "מחיר"],
      ["אלפא", 1200],
    ]);
    wb.addWorksheet("Notes").addRow(["valid until", new Date("2026-11-01T00:00:00Z")]);
    const r = await extractDocumentText(Buffer.from(await wb.xlsx.writeBuffer()), XLSX);
    expect(r.kind).toBe("text");
    if (r.kind === "text") {
      expect(r.text).toContain("[גיליון: הצעה]\nספק\tמחיר\nאלפא\t1200");
      expect(r.text).toContain("valid until\t2026-11-01");
    }
  });

  it("reads a PDF with its pages marked", async () => {
    const r = await extractDocumentText(await pdf(["Policy number 12345 for the vehicle", "Coverage starts on the first of the month"]), "application/pdf");
    expect(r).toMatchObject({ kind: "text", pages: 2 });
    if (r.kind === "text") {
      expect(r.text).toContain("[עמוד 1]\nPolicy number 12345");
      expect(r.text).toContain("[עמוד 2]");
    }
  });

  it("says a PDF with no text layer is probably a scan, rather than returning nothing", async () => {
    const r = await extractDocumentText(await pdf(["", ""]), "application/pdf");
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.reason).toContain("scan");
  });

  it("returns plain text as is", async () => {
    const r = await extractDocumentText(Buffer.from("שורה אחת\nשורה שתיים"), "text/plain");
    expect(r.kind === "text" && r.text).toBe("שורה אחת\nשורה שתיים");
  });

  it("hands images back as images", async () => {
    expect((await extractDocumentText(Buffer.from([1, 2, 3]), "image/jpeg")).kind).toBe("image");
  });

  it("says so for a type it cannot read, and for a damaged file", async () => {
    expect((await extractDocumentText(Buffer.from("x"), "application/zip")).kind).toBe("none");
    expect((await extractDocumentText(Buffer.from("not a zip"), DOCX)).kind).toBe("none");
  });
});

describe("helpers", () => {
  it("cuts long text at the limit and says it did", () => {
    const r = clipText("א".repeat(MAX_DOCUMENT_TEXT_CHARS + 10));
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(MAX_DOCUMENT_TEXT_CHARS);
  });

  it("keeps table cells apart in Word tables", () => {
    const xml = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>שם</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>תאריך</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
    expect(wordXmlToText(xml)).toContain("שם");
    expect(wordXmlToText(xml)).toContain("תאריך");
  });
});
