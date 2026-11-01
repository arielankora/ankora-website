import { NextResponse } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { UnipileError, isConfigured, readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { fetchMessageAttachment, inlineKind } from "@/lib/whatsapp-poc/voice-notes";

// WhatsApp POC: one file attached to a WhatsApp message (an image, a video,
// a document), for the chat view. Same gate as the screen; nothing is
// cached or stored.
//
// Only images, video and audio are served inline. Anything else goes out
// as a download, with nosniff and a sandbox CSP, so a file someone sent
// (an HTML page, an SVG) can never run as a page on our own domain.
export async function GET(
  _request: Request,
  props: { params: Promise<{ chatId: string; messageId: string; attachmentId: string }> },
) {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }
  const config = readPocConfig();
  if (!canViewWhatsappPoc(user, config.viewers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isConfigured(config)) return NextResponse.json({ error: "Not configured" }, { status: 404 });

  const { chatId, messageId, attachmentId } = await props.params;
  try {
    const file = await fetchMessageAttachment(
      config,
      decodeURIComponent(chatId),
      decodeURIComponent(messageId),
      decodeURIComponent(attachmentId),
    );
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const inline = inlineKind(file.contentType) !== null;
    return new NextResponse(file.bytes, {
      headers: {
        "content-type": inline ? file.contentType : "application/octet-stream",
        "content-length": String(file.bytes.byteLength),
        "cache-control": "private, no-store",
        "content-disposition": inline ? "inline" : "attachment",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
      },
    });
  } catch (err) {
    if (err instanceof UnipileError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 429 ? 429 : 502 });
    }
    throw err;
  }
}
