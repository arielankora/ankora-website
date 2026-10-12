import { NextResponse } from "next/server";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { MAX_DOCUMENT_BYTES, redeemDownloadTicket, redeemUploadTicket, type TicketOutcome } from "@/lib/app-domain/mcp-files";
import { attachmentDisposition } from "@/lib/http-headers";

// MCP document files (12.10.2026): where Claude sends a document's bytes,
// or fetches them, without passing them through the model.
//
//   PUT  /api/mcp/files/<ticket>   files the document start_document_upload
//                                  described (curl -T file <url>)
//   GET  /api/mcp/files/<ticket>   the bytes of the document read_document
//                                  was asked about
//
// The ticket in the path is the whole credential: no session, no bearer
// header, because the caller is a shell in Claude's environment that holds
// neither. It is 256 random bits, lives 15 minutes, is stored only as a
// hash, and is good for one purpose on one document. Everything else is
// decided in lib/app-domain/mcp-files.ts against the person who asked for
// it, at the moment it is used.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/// Requests per IP per minute. A real flow makes one or two; this is here
/// for a scanner guessing paths, which never reaches the database anyway
/// because a malformed ticket is refused on its shape.
const LIMIT = 30;
const WINDOW_MS = 60_000;

async function limited(req: Request): Promise<Response | null> {
  const result = await checkRateLimit(`mcp-files:${clientIpFrom(req.headers)}`, LIMIT, WINDOW_MS);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds), "Cache-Control": "no-store" } }
  );
}

function answer(outcome: TicketOutcome): Response {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers });
  if ("body" in outcome) {
    return new NextResponse(outcome.body, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": outcome.mimeType,
        "Content-Disposition": attachmentDisposition(outcome.fileName),
      },
    });
  }
  return NextResponse.json(outcome.json, { status: outcome.status, headers });
}

type Params = { params: Promise<{ ticket: string }> };

export async function GET(req: Request, { params }: Params) {
  const refused = await limited(req);
  if (refused) return refused;
  const { ticket } = await params;
  return answer(await redeemDownloadTicket(ticket));
}

async function upload(req: Request, { params }: Params) {
  const refused = await limited(req);
  if (refused) return refused;
  const { ticket } = await params;

  // Refused on the header when it already says too big, so a 40MB scan is
  // not read into memory just to be turned away. The domain checks the
  // real length again.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_DOCUMENT_BYTES) {
    return answer({ ok: false, status: 413, error: "The file is over 4MB. Compress it, or scan again at a lower resolution, and send it to the same address." });
  }

  // `curl -F file=@x.pdf` is the other thing people (and models) type.
  // Stored raw, the multipart envelope would be filed as a corrupt document,
  // so the file part is taken out of it instead.
  const contentType = req.headers.get("content-type");
  if (contentType?.toLowerCase().startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = [...form.values()].find((v): v is File => v instanceof File);
    if (!file) return answer({ ok: false, status: 400, error: "No file in the form. Send the file as the raw body: curl -T file.pdf <url>" });
    return answer(await redeemUploadTicket(ticket, Buffer.from(await file.arrayBuffer()), file.type || null));
  }

  const content = Buffer.from(await req.arrayBuffer());
  return answer(await redeemUploadTicket(ticket, content, contentType));
}

export { upload as PUT, upload as POST };
