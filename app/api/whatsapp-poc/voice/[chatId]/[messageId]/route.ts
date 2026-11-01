import { NextResponse } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { UnipileError, isConfigured, readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { fetchVoiceNote } from "@/lib/whatsapp-poc/voice-notes";

// WhatsApp POC: one WhatsApp voice message's audio, for the player in the
// chat view. Same gate as the screen. Nothing is cached or stored.
export async function GET(_request: Request, props: { params: Promise<{ chatId: string; messageId: string }> }) {
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

  const { chatId, messageId } = await props.params;
  try {
    const audio = await fetchVoiceNote(config, decodeURIComponent(chatId), decodeURIComponent(messageId));
    if (!audio) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(audio.bytes, {
      headers: {
        "content-type": audio.contentType,
        "content-length": String(audio.bytes.byteLength),
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnipileError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 429 ? 429 : 502 });
    }
    throw err;
  }
}
