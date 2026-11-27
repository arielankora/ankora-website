import "server-only";
import { Prisma, type CallDirection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { removeDriveFileOrQueue } from "@/lib/comms/drive-deletions";
import { recordAudit } from "@/lib/app-auth/audit";
import { downloadFileFromDrive, removeDriveFile, uploadLargeFileToDriveFolder } from "@/lib/google-drive";
import { callSide, fetchRecording, fetchRecordingAudio, listRecordingPage, type Recording } from "@/lib/whatsapp-poc/recordings";
import { NO_SPEECH_TRANSCRIPT, TranscriptionError, transcribeHebrew } from "@/lib/whatsapp-poc/transcribe";
import { UnipileError, readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { mp3DurationSeconds } from "./mp3-duration";
import { loadCallBlockIndex } from "./call-blocks";
import { storedCallLine } from "./call-lines";
import { fetchVoiceNote } from "@/lib/whatsapp-poc/voice-notes";
import { alertAdmins } from "./admin-alert";
import { reportIssue } from "@/lib/system-issues";

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

export function readCallStoreConfig(): { mail: MailConfig | null; lines: string[]; driveFolder: string | null } {
  const config = readPocConfig();
  return {
    mail: config.apiKey && config.mailAccountId ? { apiKey: config.apiKey, mailAccountId: config.mailAccountId } : null,
    lines: config.lineNumbers,
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

export const UNRECOGNIZED_RECORDING_NOTIFICATION_TYPE = "unrecognized_recording";

/// An email from Aloha with audio that could not be read (24.11.2026: Aloha
/// changed its template and the recordings were dropped in silence). One
/// alert a day for the template, however many calls it drops.
export async function alertUnrecognizedRecording(emailId: string): Promise<void> {
  // The admins hear of it below, in words.
  console.warn("call-store: Aloha recording email not recognized", { emailId });
  await alertAdmins({
    type: UNRECOGNIZED_RECORDING_NOTIFICATION_TYPE,
    subjectId: "aloha-recording-template",
    entityType: "Email",
    render: (t) => ({ title: t("unrecognizedRecording.title"), body: t("unrecognizedRecording.body", { emailId }) }),
  });
}

function driveName(rec: Recording, side: { other: string }): string {
  return `${rec.callAt.slice(0, 19).replace(/[:T]/g, "-")}_${side.other.replace(/\D/g, "")}.mp3`;
}

/// "blocked": the number is blocked on the line owner's WhatsApp, so nothing
/// of the call is kept (lib/comms/call-block-rules.ts).
export type StoreResult = "stored" | "exists" | "not-a-recording" | "blocked";

/// Store one recording email. Safe to call twice for the same email: the
/// second call finds the row and stops, and two calls racing meet on the
/// unique email id.
export async function storeRecording(emailId: string): Promise<StoreResult> {
  const { mail, lines, driveFolder } = readCallStoreConfig();
  if (!mail) return "not-a-recording";
  if (await prisma.callRecording.findUnique({ where: { emailId }, select: { id: true } })) return "exists";

  const found = await fetchRecording(mail, emailId, { onUnrecognized: (id) => alertUnrecognizedRecording(id) });
  if (!found) return "not-a-recording";
  const { recording, audio } = found;
  const side = callSide(recording, lines);
  if ((await loadCallBlockIndex()).stateFor(side.line, side.other) === "blocked") {
    await prisma.callRecordingSkip.upsert({ where: { emailId }, create: { emailId }, update: {} });
    return "blocked";
  }

  let driveFileId: string | null = null;
  if (driveFolder) {
    const upload = await uploadLargeFileToDriveFolder({
      name: driveName(recording, side),
      mimeType: audio.contentType,
      content: Buffer.from(audio.bytes),
      folderId: driveFolder,
    });
    if (upload.ok && upload.fileId) driveFileId = upload.fileId;
    // The audio stays in the mailbox; completeDriveCopies copies it later.
    else console.warn("call-store: Drive upload failed", upload.error);
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
      if (driveFileId) await removeDriveFileOrQueue(driveFileId, "call-duplicate");
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

/// "held": waits for a manager's decision on a block request, and the queue
/// moves on to the next one.
/// "copied": the same voice message, stored on another of our numbers, was
/// already transcribed, and its text was copied. "waiting": it is queued on
/// another of our numbers that stored it first; the next run copies it.
export type TranscribeOutcome = "done" | "failed" | "retry" | "capped" | "skipped" | "unavailable" | "held" | "copied" | "waiting";

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
  if (!process.env.OPENAI_API_KEY?.trim()) {
    // Stops the whole queue (27.11.2026: it used to stop it in silence).
    await reportIssue({ area: "comms", key: "transcribe:no-key", title: "OPENAI_API_KEY חסר: התמלול של שיחות והודעות קוליות עצר", severity: "CRITICAL" });
    return "unavailable";
  }
  // Stage 3: a voice message held by a block request waits for the decision.
  // 14.11.2026: "held", not "unavailable", which stopped the whole queue.
  if (t.attachment?.message.held) return "held";
  if (t.recording && (await loadCallBlockIndex()).stateFor(storedCallLine(t.recording), t.recording.otherPhone) !== "none") return "held";

  const phone = t.recording?.otherPhone ?? t.attachment?.message.conversation.otherPhone ?? null;
  if (phone && (await isAiExcludedNumber(phone))) {
    await prisma.transcript.update({ where: { id: t.id }, data: { status: "SKIPPED" } });
    return "skipped";
  }

  // 27.11.2026: a voice message in a group with two of our numbers, or sent
  // from one of our numbers to another, is stored once per number, and was
  // sent to OpenAI once per number. The first one stored is transcribed; the
  // others copy its text.
  if (t.attachment) {
    const twin = await voiceTwin(t.id, t.createdAt, t.attachment.id, t.attachment.externalId, t.attachment.message.externalId);
    if (twin.kind === "done") {
      await prisma.transcript.update({
        where: { id: t.id },
        data: { status: "DONE", text: twin.text, model: twin.model, doneAt: new Date(), lastError: null },
      });
      console.log("transcribe: copied", { transcriptId: t.id, from: twin.transcriptId });
      return "copied";
    }
    if (twin.kind === "waiting") {
      console.log("transcribe: waiting for twin", { transcriptId: t.id, twin: twin.transcriptId });
      return "waiting";
    }
  }

  // 25.11.2026: what was tried, and why it failed, goes to the log (ids,
  // sizes and codes only: no number, no audio, no text). A start line with
  // no end line means the function was cut off mid-way.
  const source = t.recording ? "recording" : "voice";
  const durationSec = t.recording?.durationSec ?? t.attachment?.durationSec ?? null;
  const inDrive = Boolean(t.recording?.driveFileId ?? t.attachment?.driveFileId);
  console.log("transcribe: start", { transcriptId: t.id, source, attempts: t.attempts, durationSec, inDrive });
  try {
    const audio = t.recording ? await storedRecordingAudio(t.recording) : await storedVoiceAudio(t.attachment!);
    if (!audio) throw new TranscriptionError("קובץ השמע לא נמצא.", null, "comms.transcription.audioNotFound");
    const { text, model } = await transcribeHebrew(audio, { durationSec });
    await prisma.transcript.update({
      where: { id: t.id },
      data: { status: "DONE", text: text || NO_SPEECH_TRANSCRIPT, model, doneAt: new Date(), lastError: null },
    });
    return "done";
  } catch (err) {
    // One attempt's diagnostics, for the log. A transcript that will not be
    // tried again, a rejected key and the spending cap are system issues below.
    console.warn("transcribe: failed", {
      transcriptId: t.id,
      source,
      durationSec,
      inDrive,
      attempt: t.attempts + 1,
      error: err instanceof Error ? err.name : typeof err,
      ...(err instanceof TranscriptionError || err instanceof UnipileError ? { code: err.code, status: err.status, detail: err.message } : {}),
    });
    if (err instanceof TranscriptionError && err.status === 429) {
      await prisma.transcript.update({ where: { id: t.id }, data: { status: "PENDING", lastError: err.message } });
      // The queue waits with no end until the cap is raised (27.11.2026).
      await reportIssue({ area: "comms", key: "transcribe:capped", title: "מכסת התמלול ב-OpenAI נגמרה: התמלול ממתין עד שמגדילים אותה", error: err, severity: "CRITICAL" });
      return "capped";
    }
    if (!(err instanceof TranscriptionError) && !(err instanceof UnipileError)) throw err;
    // 27.11.2026: a voice message Unipile answers 404 for is gone, and each
    // try took 30 seconds: ten of them used the whole transcription budget
    // of the nightly run, and three were transcribed. Failed at once, and
    // marked gone like whatsapp-store.ts's markVoiceGone (not imported:
    // that module imports this one).
    if (err instanceof UnipileError && err.status === 404 && t.attachment) {
      await prisma.commsAttachment.update({ where: { id: t.attachment.id }, data: { unavailable: true } });
      await prisma.transcript.update({
        where: { id: t.id },
        data: { attempts: Math.max(t.attempts + 1, TRANSCRIBE_MAX_ATTEMPTS), lastError: err.message, status: "FAILED" },
      });
      return "failed";
    }
    if (err instanceof TranscriptionError && err.code === "comms.transcription.keyRejected") {
      // Every item would burn its attempts on it, three nights to FAILED for good.
      await reportIssue({ area: "comms", key: "transcribe:key-rejected", title: "OpenAI דחה את מפתח התמלול: כל התמלולים נכשלים", error: err, severity: "CRITICAL" });
    }
    const attempts = t.attempts + 1;
    const failed = attempts >= TRANSCRIBE_MAX_ATTEMPTS;
    await prisma.transcript.update({
      where: { id: t.id },
      data: { attempts, lastError: err.message, status: failed ? "FAILED" : "PENDING" },
    });
    if (failed) {
      // Never tried again (transcribePending reads PENDING only), and before
      // 27.11.2026 nobody was told: the 36 minute voice message of 26.11.
      await reportIssue({
        area: "comms",
        key: `transcribe:failed:${t.id}`,
        title: `${source === "voice" ? "הודעה קולית" : "הקלטת שיחה"}${durationSec ? ` של ${Math.round(durationSec / 60)} דקות` : ""} לא תומללה אחרי ${TRANSCRIBE_MAX_ATTEMPTS} ניסיונות`,
        detail: `transcript ${t.id}: ${err.message}`,
        severity: "CRITICAL",
      });
    }
    return failed ? "failed" : "retry";
  }
}

/// The same voice message stored on another of our numbers: same WhatsApp
/// message id and attachment id, another attachment row. Its transcript is
/// copied when done; while it is queued and was stored first (and is not
/// held by a block request), this one waits for it. A twin that was skipped
/// ("בלי AI" on that number's side) or failed is not waited for.
export async function voiceTwin(
  transcriptId: string,
  createdAt: Date,
  attachmentId: string,
  attachmentExternalId: string,
  messageExternalId: string,
): Promise<{ kind: "none" } | { kind: "done"; transcriptId: string; text: string; model: string | null } | { kind: "waiting"; transcriptId: string }> {
  const twins = await prisma.transcript.findMany({
    where: {
      id: { not: transcriptId },
      attachment: { id: { not: attachmentId }, externalId: attachmentExternalId, type: "audio", message: { externalId: messageExternalId } },
    },
    select: { id: true, status: true, text: true, model: true, attempts: true, createdAt: true, attachment: { select: { message: { select: { held: true } } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const done = twins.find((w) => w.status === "DONE" && w.text);
  if (done) return { kind: "done", transcriptId: done.id, text: done.text!, model: done.model };
  const first = twins.find(
    (w) =>
      w.status === "PENDING" &&
      w.attempts < TRANSCRIBE_MAX_ATTEMPTS &&
      !w.attachment?.message.held &&
      (w.createdAt < createdAt || (w.createdAt.getTime() === createdAt.getTime() && w.id < transcriptId)),
  );
  return first ? { kind: "waiting", transcriptId: first.id } : { kind: "none" };
}

/// Work through the queue, oldest first, until it is empty, the time
/// budget is spent, or OpenAI says the cap is reached.
export async function transcribePending(options: { budgetMs: number; max?: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const start = now();
  const counts: Record<TranscribeOutcome, number> = { done: 0, failed: 0, retry: 0, capped: 0, skipped: 0, unavailable: 0, held: 0, copied: 0, waiting: 0 };
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
    const known = new Set([
      ...(await prisma.callRecording.findMany({ where: { emailId: { in: ids } }, select: { emailId: true } })).map((r) => r.emailId),
      // Emails left out on purpose (a blocked number) count as handled.
      ...(await prisma.callRecordingSkip.findMany({ where: { emailId: { in: ids } }, select: { emailId: true } })).map((r) => r.emailId),
    ]);
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
    for (const rec of recs) if (rec.driveFileId) await removeDriveFileOrQueue(rec.driveFileId, "call-quiet-number");
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
