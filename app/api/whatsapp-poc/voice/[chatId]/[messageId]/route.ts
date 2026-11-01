import { NextResponse } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { accountForChatFile } from "@/lib/comms/route-access";
import { UnipileError } from "@/lib/whatsapp-poc/unipile";
import { fetchVoiceNote } from "@/lib/whatsapp-poc/voice-notes";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { prisma } from "@/lib/prisma";

// WhatsApp POC: one WhatsApp voice message's audio, for the player in the
// chat view. Same gate as the screen. Nothing is cached or stored.
export async function GET(
  request: Request, props: { params: Promise<{ chatId: string; messageId: string }> }) {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const { chatId, messageId } = await props.params;
  // 1.11.2026 (several numbers): the chat's own number (?n=), checked.
  const config = await accountForChatFile(user, new URL(request.url).searchParams.get("n"), decodeURIComponent(chatId));
  if (!config) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    // Stage 3: a stored voice message is played from its Drive copy.
    const stored = await prisma.commsAttachment.findFirst({
      where: {
        type: "audio",
        driveFileId: { not: null },
        message: { externalId: decodeURIComponent(messageId), held: false, conversation: { externalChatId: decodeURIComponent(chatId) } },
      },
      select: { driveFileId: true, mimetype: true },
    });
    const fromDrive = stored?.driveFileId ? await downloadFileFromDrive(stored.driveFileId) : null;
    const audio =
      fromDrive?.ok && fromDrive.body
        ? { bytes: fromDrive.body, contentType: stored?.mimetype ?? "audio/ogg" }
        : await fetchVoiceNote(config, decodeURIComponent(chatId), decodeURIComponent(messageId));
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
