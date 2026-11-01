import "server-only";
import { Prisma, type CallDirection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { downloadFileFromDrive, removeDriveFile, uploadLargeFileToDriveFolder } from "@/lib/google-drive";
import { callSide, fetchRecording, fetchRecordingAudio, listRecordingPage, type Recording } from "@/lib/whatsapp-poc/recordings";
import { TranscriptionError, transcribeHebrew } from "@/lib/whatsapp-poc/transcribe";
import { UnipileError, readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { mp3DurationSeconds } from "./mp3-duration";
import { fetchVoiceNote } from "@/lib/whatsapp-poc/voice-notes";

// Communications storage, stage 2 (1.11.2026, spec "שמירת שיחות, הקלטות
// ותמלולים", approved by Ariel). The Aloha line's recordings are kept here:
//   - a new recording email arrives (Unipile's email.new webhook, or the
//     nightly reconcile that catches what the webhook missed);
//   - its numbers and time are stored, its audio copied to a private Drive
//     folder, and a transcript queued;
//   - the queue sends the audio to OpenAI, unless the number belongs to a
//     client marked "בלי AI";
//   - after 12 months the audio is removed and the transcript stays; a
//     number that is in no client's file and has been quiet for 12 months
//     is removed entirely.

export const TRANSCRIBE_MAX_ATTEMPTS = 3;
export const AUDIO_RETENTION_DAYS = 365;
export const UNASSIGNED_RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

type MailConfig = { apiKey: string; mailAccountId: string };

export function readCallStoreConfig(): { mail: MailConfig | null; line: string | null; driveFolder: string | null } {
  const config = readPocConfig();
  return {
    mail: config.apiKey && config.mailAccountId ? { apiKey: config.apiKey, mailAccountId: config.mailAccountId } : null,
    line: config.lineNumber,
    driveFolder: process.env.GOOGLE_DRIVE_FOLDER_CALL_RECORDINGS?.trim() || null,
  };
}

const DIRECTION: Record<"in" | "out" | "unknown", CallDirection> = { in: "IN", out: "OUT", unknown: "UNKNOWN" };

/// True when the number belongs to someone in the file of a client marked
/// "בלי AI". Their calls are kept and played, never transcribed.
export async function isAiExcludedNumber(phone: string): Promise<boolean> {
  const hit = await prisma.person.findFirst({
    where: {
      deletedAt: null,
      phones: { has: phone },
      contacts: { some: { deletedAt: null, client: { aiExcluded: true } } },
    },
    select: { id: true },
  });
  return hit !== null;
}

function driveName(rec: Recording, side: { other: string }): string {
  return `${rec.callAt.slice(0, 19).replace(/[:T]/g, "-")}_${side.other.replace(/\D/g, "")}.mp3`;
}

export type StoreResult = "stored" | "exists" | "not-a-recording";

/// Store one recording email. Safe to call twice for the same email: the
/// second call finds the row and stops, and two calls racing meet on the
/// unique email id.
export async function storeRecording(emailId: string): Promise<StoreResult> {
  const { mail, line, driveFolder } = readCallStoreConfig();
  if (!mail) return "not-a-recording";
  if (await prisma.callRecording.findUnique({ where: { emailId }, select: { id: true } })) return "exists";

  const found = await fetchRecording(mail, emailId);
  if (!found) return "not-a-recording";
  const { recording, audio } = found;
  const side = callSide(recording, line);

  let driveFileId: string | null = null;
  if (driveFolder) {
    const upload = await uploadLargeFileToDriveFolder({
      name: driveName(recording, side),
      mimeType: audio.contentType,
      content: Buffer.from(audio.bytes),
      folderId: driveFolder,
    });
    if (upload.ok && upload.fileId) driveFileId = upload.fileId;
    else console.error("call-store: Drive upload failed", upload.error);
  }

  const skip = await isAiExcludedNumber(side.other);
  try {
    await prisma.callRecording.create({
      data: {
        emailId,
        mailAccountId: mail.mailAccountId,
        fromPhone: recording.from,
        toPhone: recording.to,
        otherPhone: side.other,
        direction: DIRECTION[side.direction],
        callAt: new Date(recording.callAt),
        durationSec: mp3DurationSeconds(audio.bytes),
        sizeBytes: audio.bytes.byteLength,
        mimeType: audio.contentType,
        driveFileId,
        transcript: { create: { status: skip ? "SKIPPED" : "PENDING" } },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Lost the race to another call for the same email; drop our copy.
      if (driveFileId) await removeDriveFile(driveFileId);
      return "exists";
    }
    throw err;
  }
  return "stored";
}

/// The audio of a stored recording: the Drive copy, or the mailbox when
/// there is none (not copied yet, or no Drive folder configured).
export async function storedRecordingAudio(rec: {
  emailId: string;
  driveFileId: string | null;
  mimeType: string;
}): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (rec.driveFileId) {
    const file = await downloadFileFromDrive(rec.driveFileId);
    if (file.ok && file.body) return { bytes: file.body, contentType: rec.mimeType };
  }
  const { mail } = readCallStoreConfig();
  return mail ? fetchRecordingAudio(mail, rec.emailId) : null;
}

/// A stored WhatsApp voice message's audio: its Drive copy, else Unipile.
export async function storedVoiceAudio(a: {
  externalId: string;
  driveFileId: string | null;
  mimetype: string | null;
  message: { externalId: string; conversation: { externalChatId: string; channel: { accountId: string } } };
}): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (a.driveFileId) {
    const file = await downloadFileFromDrive(a.driveFileId);
    if (file.ok && file.body) return { bytes: file.body, contentType: a.mimetype ?? "audio/ogg" };
  }
  const apiKey = process.env.UNIPILE_API_KEY?.trim();
  if (!apiKey) return null;
  return fetchVoiceNote(
    { apiKey, accountId: a.message.conversation.channel.accountId },
    a.message.conversation.externalChatId,
    a.message.externalId,
  );
}

export type TranscribeOutcome = "done" | "failed" | "retry" | "capped" | "skipped" | "unavailable";

/// Transcribe one queued recording. A 429 from OpenAI (the monthly cap, or
/// a burst limit) leaves it waiting without using up an attempt.
export async function transcribeRecording(transcriptId: string): Promise<TranscribeOutcome> {
  const t = await prisma.transcript.findUnique({
    where: { id: transcriptId },
    include: {
      recording: true,
      attachment: { include: { message: { include: { conversation: { include: { channel: true } } } } } },
    },
  });
  if (!t || (!t.recording && !t.attachment) || (t.status !== "PENDING" && t.status !== "FAILED")) return "unavailable";
  if (!process.env.OPENAI_API_KEY?.trim()) return "unavailable";
  // Stage 3: a voice message held by a block request waits for the decision.
  if (t.attachment?.message.held) return "unavailable";

  const phone = t.recording?.otherPhone ?? t.attachment?.message.conversation.otherPhone ?? null;
  if (phone && (await isAiExcludedNumber(phone))) {
    await prisma.transcript.update({ where: { id: t.id }, data: { status: "SKIPPED" } });
    return "skipped";
  }

  try {
    const audio = t.recording ? await storedRecordingAudio(t.recording) : await storedVoiceAudio(t.attachment!);
    if (!audio) throw new TranscriptionError("קובץ השמע לא נמצא.");
    const { text, model } = await transcribeHebrew(audio);
    await prisma.transcript.update({
      where: { id: t.id },
      data: { status: "DONE", text: text || "(לא זוהה דיבור)", model, doneAt: new Date(), lastError: null },
    });
    return "done";
  } catch (err) {
    if (err instanceof TranscriptionError && err.status === 429) {
      await prisma.transcript.update({ where: { id: t.id }, data: { status: "PENDING", lastError: err.message } });
      return "capped";
    }
    if (!(err instanceof TranscriptionError) && !(err instanceof UnipileError)) throw err;
    const attempts = t.attempts + 1;
    const failed = attempts >= TRANSCRIBE_MAX_ATTEMPTS;
    await prisma.transcript.update({
      where: { id: t.id },
      data: { attempts, lastError: err.message, status: failed ? "FAILED" : "PENDING" },
    });
    return failed ? "failed" : "retry";
  }
}

/// Work through the queue, oldest first, until it is empty, the time
/// budget is spent, or OpenAI says the cap is reached.
export async function transcribePending(options: { budgetMs: number; max?: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const start = now();
  const counts: Record<TranscribeOutcome, number> = { done: 0, failed: 0, retry: 0, capped: 0, skipped: 0, unavailable: 0 };
  const queue = await prisma.transcript.findMany({
    where: { status: "PENDING", attempts: { lt: TRANSCRIBE_MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: options.max ?? 50,
    select: { id: true },
  });
  for (const item of queue) {
    if (now() - start > options.budgetMs) break;
    const outcome = await transcribeRecording(item.id);
    counts[outcome] += 1;
    if (outcome === "capped" || outcome === "unavailable") break;
  }
  return counts;
}

/// Store what the webhook missed. Pages back through the recording emails
/// until a whole page is already stored (the first run walks back through
/// the mailbox's history, a page at a time across nights if it must).
export async function reconcileRecordings(options: { budgetMs: number; maxPages?: number; now?: () => number }) {
  const { mail } = readCallStoreConfig();
  const now = options.now ?? Date.now;
  const start = now();
  const result = { pages: 0, stored: 0, stoppedBy: "done" as "done" | "budget" | "quota" | "not-configured" };
  if (!mail) return { ...result, stoppedBy: "not-configured" as const };

  let cursor: string | null = null;
  for (let page = 0; page < (options.maxPages ?? 20); page++) {
    let listed: { recordings: Recording[]; nextCursor: string | null };
    try {
      listed = await listRecordingPage(mail, cursor);
    } catch (err) {
      if (err instanceof UnipileError && err.status === 429) return { ...result, stoppedBy: "quota" as const };
      throw err;
    }
    result.pages += 1;
    const ids = listed.recordings.map((r) => r.emailId);
    const known = new Set(
      (await prisma.callRecording.findMany({ where: { emailId: { in: ids } }, select: { emailId: true } })).map((r) => r.emailId),
    );
    const missing = ids.filter((id) => !known.has(id));
    for (const id of missing) {
      if (now() - start > options.budgetMs) return { ...result, stoppedBy: "budget" as const };
      try {
        if ((await storeRecording(id)) === "stored") result.stored += 1;
      } catch (err) {
        if (err instanceof UnipileError && err.status === 429) return { ...result, stoppedBy: "quota" as const };
        throw err;
      }
    }
    if (missing.length === 0 || !listed.nextCursor) break;
    cursor = listed.nextCursor;
  }
  return result;
}

/// The retention the spec sets: audio for 12 months, then only the
/// transcript; a number in no client's file, quiet for 12 months, removed.
export async function sweepCallRetention(now = new Date()) {
  const audioCutoff = new Date(now.getTime() - AUDIO_RETENTION_DAYS * DAY_MS);
  const oldAudio = await prisma.callRecording.findMany({
    where: { callAt: { lt: audioCutoff }, driveFileId: { not: null } },
    select: { id: true, driveFileId: true },
    take: 200,
  });
  let audioRemoved = 0;
  for (const rec of oldAudio) {
    const removed = await removeDriveFile(rec.driveFileId!);
    if (!removed.ok) continue;
    await prisma.callRecording.update({ where: { id: rec.id }, data: { driveFileId: null, audioDeletedAt: now } });
    audioRemoved += 1;
  }

  const quietCutoff = new Date(now.getTime() - UNASSIGNED_RETENTION_DAYS * DAY_MS);
  const quiet = await prisma.callRecording.groupBy({
    by: ["otherPhone"],
    _max: { callAt: true },
    having: { callAt: { _max: { lt: quietCutoff } } },
  });
  const phones = quiet.map((q) => q.otherPhone);
  const owned = phones.length
    ? new Set(
        (
          await prisma.person.findMany({
            where: { deletedAt: null, phones: { hasSome: phones }, contacts: { some: { deletedAt: null } } },
            select: { phones: true },
          })
        ).flatMap((p) => p.phones),
      )
    : new Set<string>();
  let recordingsRemoved = 0;
  for (const phone of phones.filter((p) => !owned.has(p))) {
    const recs = await prisma.callRecording.findMany({ where: { otherPhone: phone }, select: { id: true, driveFileId: true } });
    for (const rec of recs) if (rec.driveFileId) await removeDriveFile(rec.driveFileId);
    const { count } = await prisma.callRecording.deleteMany({ where: { otherPhone: phone } });
    recordingsRemoved += count;
  }
  if (audioRemoved || recordingsRemoved) {
    await recordAudit({
      actorId: null,
      action: "call_recording.retention_sweep",
      entityType: "CallRecording",
      entityId: null,
      after: { audioRemoved, recordingsRemoved },
    });
  }
  return { audioRemoved, recordingsRemoved };
}
