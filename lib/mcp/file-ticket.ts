import crypto from "crypto";

// MCP document files (12.10.2026): the pure half.
//
// Claude moves documents in and out of a client's file (ClientDocument)
// over the staff connector. Everything here that has no database or Drive
// behind it lives in this module, so tests/unit/mcp/file-ticket.test.ts can
// run it directly.
//
// Uploading has two paths:
//
//   * upload_document carries the file inside the tool call, base64. It works
//     in any Claude, including a chat with no shell, and it is expensive: a
//     base64 file is spent as tokens, once on the way out of the model and
//     again in the transcript. So it is capped at 1MB, which covers a signed
//     form or a Word file and nothing bigger.
//
//   * start_document_upload returns a one-time address, and Claude sends the
//     bytes there itself (curl from its own environment). The file never
//     passes through the model, so the cap is the product's real one, 4MB,
//     and the token cost is zero. This is the path that works for a scan or
//     a PDF, and the one a Claude with a shell should always prefer.
//
// Reading (read_document) returns the document's text where Ankora can
// extract it, and the same kind of short-lived address for the bytes, for a
// Claude that would rather open the file itself.
//
// An address is a bearer capability, valid for 15 minutes, for one purpose
// and one document. An upload address files ONE document into the client and
// task it was issued for; everything about what gets filed is fixed when it
// is issued, through the MCP tool and its sign-in, and the request brings
// only bytes. That is narrow enough to put in a URL.

/// Prefix on every ticket. Same two reasons as MCP_TOKEN_PREFIX in token.ts:
/// secret scanners match on it, and a malformed path is refused before any
/// database work.
export const FILE_TICKET_PREFIX = "ank_fil_";

/// How long an issued address stays usable. Long enough for a model to
/// convert a file and run one command; short enough that an address left in
/// a transcript is dead by the time anyone reads it.
export const FILE_TICKET_TTL_MINUTES = 15;

/// The ceiling for a file carried inline, as base64, in the tool call.
export const MAX_INLINE_UPLOAD_BYTES = 1024 * 1024;

export function generateFileTicket(): string {
  return FILE_TICKET_PREFIX + crypto.randomBytes(32).toString("base64url");
}

/// What is stored. The raw ticket is shown once, in the tool result.
export function hashFileTicket(ticket: string): string {
  return crypto.createHash("sha256").update(ticket, "utf8").digest("hex");
}

export function looksLikeFileTicket(value: string | null | undefined): boolean {
  if (!value || !value.startsWith(FILE_TICKET_PREFIX)) return false;
  return /^[A-Za-z0-9_-]{43}$/.test(value.slice(FILE_TICKET_PREFIX.length));
}

export function fileTicketExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + FILE_TICKET_TTL_MINUTES * 60 * 1000);
}

export function fileTicketUrl(baseUrl: string, ticket: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/mcp/files/${ticket}`;
}

/// A file name as it will be stored: the base name only, no path, no
/// control characters, at most 200 characters. Hebrew is kept as is.
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, 200);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  webp: "image/webp",
  zip: "application/zip",
};

const GENERIC_TYPES = new Set(["application/octet-stream", "application/x-www-form-urlencoded", "binary/octet-stream"]);

/// The MIME type of a file, from what the caller said or else from its
/// extension. The model is not asked for it: it gets this wrong more often
/// than the extension does, and a wrong type is a file the portal hands out
/// with the wrong viewer.
export function mimeTypeFor(fileName: string, declared?: string | null): string {
  const d = declared?.split(";")[0].trim().toLowerCase();
  // curl sends application/x-www-form-urlencoded with --data-binary unless
  // told otherwise, and octet-stream means "unknown": neither describes the
  // file, so the extension decides.
  if (d && !GENERIC_TYPES.has(d) && /^[a-z]+\/[a-z0-9.+-]+$/.test(d)) return d;
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export type DecodedInline = { ok: true; content: Buffer } | { ok: false; message: string };

/// Decodes base64 from a tool argument, strictly.
///
/// Node's decoder is forgiving: it skips characters it does not know and
/// returns whatever it could make of the rest. A truncated or mangled string
/// would then be filed as a corrupt document the client cannot open, which
/// is worse than a refusal. So the string is checked first, and a data: URL
/// prefix (which models like to add) is accepted and removed.
export function decodeInlineFile(raw: string): DecodedInline {
  let s = raw.trim();
  const dataUrl = /^data:[^;,]*;base64,/i.exec(s);
  if (dataUrl) s = s.slice(dataUrl[0].length);
  s = s.replace(/\s+/g, "");
  if (!s) return { ok: false, message: "The file content is empty." };

  const standard = s.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(standard) || standard.replace(/=+$/, "").length % 4 === 1) {
    return {
      ok: false,
      message:
        "contentBase64 is not valid base64, so the file would arrive corrupt. Encode the whole file again (for example `base64 -w0 file`) and pass it unchanged, or use start_document_upload instead.",
    };
  }

  const content = Buffer.from(standard, "base64");
  if (content.byteLength === 0) return { ok: false, message: "The file content is empty." };
  if (content.byteLength > MAX_INLINE_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `The file is ${(content.byteLength / 1024 / 1024).toFixed(1)}MB, over the 1MB limit for inline upload. Call start_document_upload and send the file to the address it returns (up to 4MB).`,
    };
  }
  return { ok: true, content };
}
