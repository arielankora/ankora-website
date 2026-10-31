import { NextResponse } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { fetchRecordingAudio } from "@/lib/whatsapp-poc/recordings";
import { UnipileError, readPocConfig } from "@/lib/whatsapp-poc/unipile";

// WhatsApp POC, stage 2: one call recording's audio, streamed from the
// aloha@ mailbox through Unipile, for the <audio> player on the calls
// screen. Same gate as the screen. Nothing is cached or stored.
export async function GET(
  _request: Request,
  props: { params: Promise<{ emailId: string }> },
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
  if (!config.apiKey || !config.mailAccountId) return NextResponse.json({ error: "Not configured" }, { status: 404 });

  const { emailId } = await props.params;
  try {
    const audio = await fetchRecordingAudio({ apiKey: config.apiKey, mailAccountId: config.mailAccountId }, emailId);
    if (!audio) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(audio.bytes, {
      headers: {
        "content-type": audio.contentType,
        "content-length": String(audio.bytes.byteLength),
        "cache-control": "private, no-store",
        "content-disposition": "inline",
      },
    });
  } catch (err) {
    if (err instanceof UnipileError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 429 ? 429 : 502 });
    }
    throw err;
  }
}
