import { NextResponse } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { fetchRecordingAudio } from "@/lib/whatsapp-poc/recordings";
import { storedRecordingAudio } from "@/lib/comms/call-store";
import { prisma } from "@/lib/prisma";
import { UnipileError, readPocConfig } from "@/lib/whatsapp-poc/unipile";

// WhatsApp POC, stage 2: one call recording's audio, streamed from the
// aloha@ mailbox through Unipile, for the <audio> player on the calls
// screen. Same gate as the screen. 1.11.2026: a stored recording is served
// from its Drive copy (lib/comms/call-store.ts), else from the mailbox.
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
    const stored = emailId.length <= 1000 ? await prisma.callRecording.findUnique({ where: { emailId } }) : null;
    if (stored?.audioDeletedAt) return NextResponse.json({ error: "Audio removed after 12 months" }, { status: 410 });
    const audio = stored
      ? await storedRecordingAudio(stored)
      : await fetchRecordingAudio({ apiKey: config.apiKey, mailAccountId: config.mailAccountId }, emailId);
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
