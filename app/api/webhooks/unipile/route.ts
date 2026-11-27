import { NextResponse } from "next/server";
import { afterResponse } from "@/lib/after-response";
import { storeRecording, transcribeRecording } from "@/lib/comms/call-store";
import { verifyUnipileSignature } from "@/lib/comms/webhook-signature";
import { RECORDING_SENDER } from "@/lib/whatsapp-poc/recordings";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { prisma } from "@/lib/prisma";
import { deleteStoredMessage, readMessageEvent, storeMessage, updateStoredMessage } from "@/lib/comms/whatsapp-store";
import { alertChannelDisconnected } from "@/lib/comms/disconnect-alert";
import { recordMailEvent } from "@/lib/mail-scan/channels";
import { sweepIfDue } from "@/lib/mail-scan/waits";
import { alertMailChannelDisconnected } from "@/lib/mail-scan/disconnect";
import { reportIssue } from "@/lib/system-issues";

// Unipile's webhook (communications storage, 1.11.2026):
//   - email.new in the aloha@ mailbox from Aloha: a call recording (stage 2);
//   - email.new in a mailbox connected on "התיבות שלי" (27.11.2026);
//   - message.new / message.update / message.delete on a connected WhatsApp
//     number (stage 3), kept per its block list. Nothing is kept for a
//     number before its owner pressed "התחל לשמור".
//
// The delivery is signed (lib/comms/webhook-signature.ts) and refused
// without a valid signature. Unipile wants a 2xx within five seconds, so
// the answer goes out first and the work runs after it; a delivery whose
// work fails is a system issue (27.11.2026): CRITICAL, because what failed
// here is a message, a recording or an email that was not stored, and the
// nightly reconcile does not bring every one of them back.
// 26.11.2026: a long voice message is split and transcribed after the
// answer (afterResponse), which can take minutes; the default would cut it
// off with no attempt recorded.
export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Every live WhatsApp message, recording and scanned email stops here
    // (27.11.2026, silent failures audit: it used to be a 503 and nothing else).
    await reportIssue({
      area: "comms",
      key: "webhook-secret-missing",
      title: "UNIPILE_WEBHOOK_SECRET חסר: ה-webhook דוחה כל הודעה, הקלטה ומייל",
      severity: "CRITICAL",
    });
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

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
    await afterResponse(
      "unipile webhook: store recording",
      async () => {
        if ((await storeRecording(emailId)) !== "stored") return;
        const rec = await prisma.callRecording.findUnique({ where: { emailId }, select: { transcript: { select: { id: true, status: true } } } });
        if (rec?.transcript?.status === "PENDING") await transcribeRecording(rec.transcript.id);
      },
      { severity: "CRITICAL" },
    );
  }

  // 24.11.2026: a connected number that Unipile disconnected; its owner is
  // told by email, with Ariel and Hadas on copy (lib/comms/disconnect-alert.ts).
  // 27.11.2026: also the other states in which nothing arrives (Unipile v2:
  // errored, partial), and an account that is no channel of ours: the Aloha
  // mailbox (every call recording stops) or a client's mailbox. Those used
  // to end in silence.
  const status = typeof event.type === "string" ? /^account\.status\.(disconnected|errored|partial)$/.exec(event.type)?.[1] : undefined;
  if (status && typeof event.account_id === "string") {
    const accountId = event.account_id;
    await afterResponse(
      "unipile webhook: account disconnected",
      async () => {
        const whatsapp = await alertChannelDisconnected(accountId);
        const mail = await alertMailChannelDisconnected(accountId);
        if (whatsapp === "no-channel" && mail === "no-channel") await reportUnknownAccountDown(accountId, status, config.mailAccountId);
      },
      { severity: "CRITICAL" },
    );
  }

  // "התיבות שלי" (27.11.2026): a new email in a mailbox an employee
  // connected for scanning. A thread with a client is recorded (who and
  // when, never the content); anything else is left alone. Aloha's
  // mailbox is not a scanned mailbox, so the recording branch above is
  // untouched.
  if (event.type === "email.new" && typeof event.account_id === "string" && typeof email?.id === "string") {
    const accountId = event.account_id;
    const emailId = email.id;
    if (accountId !== config.mailAccountId) {
      await afterResponse(
        "unipile webhook: mailbox scan",
        async () => {
          await recordMailEvent(accountId, emailId);
          // Stage 2: due reminders go out close to their time on a working
          // day, since the cron on this plan runs once a day.
          await sweepIfDue();
        },
        { severity: "CRITICAL" },
      );
    }
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
        // CRITICAL below: a message that failed here is not stored, and the
        // nightly backfill only reads a chat it has not read before.
        const channel = await prisma.commsChannel.findUnique({ where: { accountId } });
        if (!channel?.storeEnabled) return;
        if (type === "message.delete" && read.messageId) {
          await deleteStoredMessage(channel, read.chatId, read.messageId);
        } else if (type === "message.update" && read.message) {
          await updateStoredMessage(channel, read.chatId, read.message);
        } else if (read.message) {
          await storeMessage(channel, read.chatId, read.message, { transcribe: transcribeRecording });
        }
      }, { severity: "CRITICAL" });
    }
  }
  return NextResponse.json({ ok: true });
}

/// A Unipile account went down that is neither a WhatsApp number nor a
/// scanned mailbox of ours: the Aloha mailbox the call recordings come
/// from, or a client's own mailbox (ClientConnection UNIPILE_MAIL).
async function reportUnknownAccountDown(accountId: string, status: string, alohaAccountId: string | null | undefined) {
  const aloha = alohaAccountId === accountId;
  await reportIssue({
    area: "comms",
    key: `account-down:${accountId}`,
    title: aloha
      ? `תיבת ההקלטות של Aloha במצב ${status}: הקלטות שיחה לא נקלטות עד שמחברים אותה מחדש ב-Unipile`
      : `חשבון Unipile במצב ${status} (כנראה תיבת דואר של לקוח): צריך לחבר אותו מחדש`,
    detail: `account_id ${accountId}`,
    severity: "CRITICAL",
  });
}
