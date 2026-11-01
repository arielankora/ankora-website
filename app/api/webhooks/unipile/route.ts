import { NextResponse } from "next/server";
import { afterResponse } from "@/lib/after-response";
import { storeRecording, transcribeRecording } from "@/lib/comms/call-store";
import { verifyUnipileSignature } from "@/lib/comms/webhook-signature";
import { RECORDING_SENDER } from "@/lib/whatsapp-poc/recordings";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { prisma } from "@/lib/prisma";
import { deleteStoredMessage, readMessageEvent, storeMessage, updateStoredMessage } from "@/lib/comms/whatsapp-store";

// Unipile's webhook (communications storage, 1.11.2026):
//   - email.new in the aloha@ mailbox from Aloha: a call recording (stage 2);
//   - message.new / message.update / message.delete on a connected WhatsApp
//     number (stage 3), kept per its block list. Nothing is kept for a
//     number before its owner pressed "התחל לשמור".
//
// The delivery is signed (lib/comms/webhook-signature.ts) and refused
// without a valid signature. Unipile wants a 2xx within five seconds, so
// the answer goes out first and the work runs after it; a delivery whose
// work fails is caught by the nightly reconcile.
export async function POST(request: Request) {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const rawBody = await request.text();
  if (!verifyUnipileSignature({ header: request.headers.get("unipile-signature"), rawBody, secret })) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let event: {
    type?: unknown;
    account_id?: unknown;
    payload?: { email?: { id?: unknown; from?: Array<{ email?: unknown }> } } & Record<string, unknown>;
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  const config = readPocConfig();
  const email = event.payload?.email;
  if (
    event.type === "email.new" &&
    config.mailAccountId &&
    event.account_id === config.mailAccountId &&
    typeof email?.id === "string" &&
    email.from?.some((f) => typeof f.email === "string" && f.email.toLowerCase() === RECORDING_SENDER)
  ) {
    const emailId = email.id;
    await afterResponse("unipile webhook: store recording", async () => {
      if ((await storeRecording(emailId)) !== "stored") return;
      const rec = await prisma.callRecording.findUnique({ where: { emailId }, select: { transcript: { select: { id: true, status: true } } } });
      if (rec?.transcript?.status === "PENDING") await transcribeRecording(rec.transcript.id);
    });
  }

  // Stage 3: WhatsApp messages of a connected number.
  if (
    typeof event.account_id === "string" &&
    (event.type === "message.new" || event.type === "message.update" || event.type === "message.delete")
  ) {
    const accountId = event.account_id;
    const type = event.type;
    const read = readMessageEvent(event.payload);
    if (read) {
      await afterResponse(`unipile webhook: ${type}`, async () => {
        const channel = await prisma.commsChannel.findUnique({ where: { accountId } });
        if (!channel?.storeEnabled) return;
        if (type === "message.delete" && read.messageId) {
          await deleteStoredMessage(channel, read.chatId, read.messageId);
        } else if (type === "message.update" && read.message) {
          await updateStoredMessage(channel, read.chatId, read.message);
        } else if (read.message) {
          await storeMessage(channel, read.chatId, read.message, { transcribe: transcribeRecording });
        }
      });
    }
  }
  return NextResponse.json({ ok: true });
}
