import { describe, expect, it } from "vitest";
import {
  FILE_TICKET_PREFIX,
  MAX_INLINE_UPLOAD_BYTES,
  cleanFileName,
  decodeInlineFile,
  fileTicketExpiry,
  fileTicketUrl,
  generateFileTicket,
  hashFileTicket,
  looksLikeFileTicket,
  mimeTypeFor,
} from "@/lib/mcp/file-ticket";

// MCP document files (12.10.2026). The pure half: the ticket format, and
// the base64 a model hands upload_document. The second one matters more
// than it looks. Node's base64 decoder never refuses: it drops what it does
// not understand and returns the rest, so a string the model truncated
// would be filed as a document that nobody can open.

describe("tickets", () => {
  it("are prefixed, 256-bit and recognised by shape", () => {
    const t = generateFileTicket();
    expect(t.startsWith(FILE_TICKET_PREFIX)).toBe(true);
    expect(looksLikeFileTicket(t)).toBe(true);
    expect(generateFileTicket()).not.toBe(t);
  });

  it("refuses anything that is not one, before any database work", () => {
    for (const v of ["", null, undefined, FILE_TICKET_PREFIX, "ank_mcp_" + "a".repeat(43), FILE_TICKET_PREFIX + "a".repeat(42), FILE_TICKET_PREFIX + "a".repeat(42) + "/"]) {
      expect(looksLikeFileTicket(v as string), String(v)).toBe(false);
    }
  });

  it("are stored as a hash, never as themselves", () => {
    const t = generateFileTicket();
    expect(hashFileTicket(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFileTicket(t)).not.toContain(t.slice(FILE_TICKET_PREFIX.length));
  });

  it("live 15 minutes", () => {
    const now = new Date("2026-10-12T08:00:00Z");
    expect(fileTicketExpiry(now).toISOString()).toBe("2026-10-12T08:15:00.000Z");
  });

  it("make an address on the app's host", () => {
    expect(fileTicketUrl("https://www.ankora.co.il/", "ank_fil_x")).toBe("https://www.ankora.co.il/api/mcp/files/ank_fil_x");
  });
});

describe("decodeInlineFile", () => {
  const bytes = Buffer.from("%PDF-1.4 שלום", "utf8");

  it("decodes plain base64, base64url and a data: URL alike", () => {
    for (const s of [bytes.toString("base64"), bytes.toString("base64url"), `data:application/pdf;base64,${bytes.toString("base64")}`]) {
      const r = decodeInlineFile(s);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.content.equals(bytes)).toBe(true);
    }
  });

  it("tolerates line breaks, which base64 tools insert every 76 characters", () => {
    const wrapped = Buffer.alloc(300, 7).toString("base64").replace(/(.{76})/g, "$1\n");
    const r = decodeInlineFile(wrapped);
    expect(r.ok && r.content.byteLength).toBe(300);
  });

  it("refuses a string that is not base64 instead of filing garbage", () => {
    for (const s of ["not base64!", "abc*def", "QUJD=X", "A"]) {
      const r = decodeInlineFile(s);
      expect(r.ok, s).toBe(false);
    }
  });

  it("refuses an empty file", () => {
    expect(decodeInlineFile("  ").ok).toBe(false);
  });

  it("refuses over 1MB, and points at the upload address", () => {
    const r = decodeInlineFile(Buffer.alloc(MAX_INLINE_UPLOAD_BYTES + 1).toString("base64"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("start_document_upload");
  });
});

describe("file names and types", () => {
  it("keeps the base name only, and Hebrew", () => {
    expect(cleanFileName("../../etc/חוזה חתום.pdf")).toBe("חוזה חתום.pdf");
    expect(cleanFileName("C:\\Users\\x\\a.docx")).toBe("a.docx");
    expect(cleanFileName("a\u0000b.pdf")).toBe("ab.pdf");
  });

  it("trusts a declared type, and otherwise the extension", () => {
    expect(mimeTypeFor("x.bin", "application/pdf; charset=binary")).toBe("application/pdf");
    expect(mimeTypeFor("חוזה.DOCX", "application/octet-stream")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(mimeTypeFor("scan.jpg", null)).toBe("image/jpeg");
    expect(mimeTypeFor("a.pdf", "application/x-www-form-urlencoded")).toBe("application/pdf");
    expect(mimeTypeFor("unknown.xyz")).toBe("application/octet-stream");
  });
});
