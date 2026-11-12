"use server";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { commsAccess } from "@/lib/comms/access";
import { mayHearCall } from "@/lib/comms/call-access";
import { accountForChatFile } from "@/lib/comms/route-access";
import { fetchRecordingAudio } from "@/lib/whatsapp-poc/recordings";
import { NO_SPEECH_TRANSCRIPT, TRANSCRIBE_MODELS, TranscriptionError, transcribeHebrew } from "@/lib/whatsapp-poc/transcribe";
import { UnipileError, readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { fetchVoiceNote } from "@/lib/whatsapp-poc/voice-notes";
import { isAiExcludedNumber, storedRecordingAudio } from "@/lib/comms/call-store";
import { prisma } from "@/lib/prisma";

export type TranscribeState = { text?: string; error?: string };

// A person presses "תמלול" on one recording. The audio goes to OpenAI and
// the text comes back to the screen; nothing is stored. The audit row
// records that a recording left for transcription, and which one, but not
// the text.
export async function transcribeRecordingAction(
  _prev: TranscribeState | undefined,
  formData: FormData,
): Promise<TranscribeState> {
  const t = await getTranslations("comms.errors");
  const user = await requireUser();
  const config = readPocConfig();
  const access = await commsAccess(user);
  if (!access.allowed) return { error: t("forbidden") };
  if (!config.apiKey || !config.mailAccountId) return { error: t("recordingsNotConfigured") };
  if (!config.hasOpenAiKey) return { error: t("transcriptionNotConfigured") };

  const emailId = String(formData.get("emailId") || "").slice(0, 1000);

  // 1.11.2026: a stored recording is transcribed on arrival; this button
  // is the retry for one that failed, and its result is saved with it. A
  // number of a client marked "בלי AI" is never sent.
  const stored = await prisma.callRecording.findUnique({ where: { emailId }, include: { transcript: true } });
  // 2.11.2026: only a call this person may see (their line, their client,
  // or all of them for the full and call viewers), as the audio route.
  if (!(await mayHearCall(access, user.id, stored))) return { error: t("forbidden") };
  if (stored && (await isAiExcludedNumber(stored.otherPhone))) return { error: t("noAi") };

  try {
    const audio = stored
      ? await storedRecordingAudio(stored)
      : await fetchRecordingAudio({ apiKey: config.apiKey, mailAccountId: config.mailAccountId }, emailId);
    if (!audio) return { error: t("recordingNotFound") };
    await recordAudit({
      actorId: user.id,
      action: "whatsapp_poc.recording_transcribed",
      entityType: "CallRecording",
      entityId: emailId,
      after: { sizeBytes: audio.bytes.byteLength, models: TRANSCRIBE_MODELS },
    });
    const { text, model } = await transcribeHebrew(audio);
    // Stored as the transcript's text: content, in Hebrew.
    const shown = text || NO_SPEECH_TRANSCRIPT;
    if (stored?.transcript) {
      await prisma.transcript.update({
        where: { id: stored.transcript.id },
        data: { status: "DONE", text: shown, model, doneAt: new Date(), lastError: null },
      });
    }
    return { text: shown };
  } catch (err) {
    if (err instanceof UnipileError || err instanceof TranscriptionError) return { error: (await domainErrorText(err)) ?? err.message };
    throw err;
  }
}

// The same, for a WhatsApp voice message in the chat view.
export async function transcribeVoiceNoteAction(
  _prev: TranscribeState | undefined,
  formData: FormData,
): Promise<TranscribeState> {
  const t = await getTranslations("comms.errors");
  const user = await requireUser();
  const config = readPocConfig();
  if (!config.hasOpenAiKey) return { error: t("transcriptionNotConfigured") };

  const chatId = String(formData.get("chatId") || "");
  const messageId = String(formData.get("messageId") || "");
  // The chat's own number, checked like the audio route (several numbers).
  const unipile = await accountForChatFile(user, String(formData.get("numberKey") || "-"), chatId);
  if (!unipile) return { error: t("forbidden") };

  try {
    const audio = await fetchVoiceNote(unipile, chatId, messageId);
    if (!audio) return { error: t("voiceNotFound") };
    await recordAudit({
      actorId: user.id,
      action: "whatsapp_poc.voice_note_transcribed",
      entityType: "WhatsAppChat",
      entityId: chatId,
      after: { messageId, sizeBytes: audio.bytes.byteLength, models: TRANSCRIBE_MODELS },
    });
    const { text } = await transcribeHebrew(audio);
    // The same words a stored transcript has for no speech: shown as the
    // transcript, so it reads the same as one that was stored.
    return { text: text || NO_SPEECH_TRANSCRIPT };
  } catch (err) {
    if (err instanceof UnipileError || err instanceof TranscriptionError) return { error: (await domainErrorText(err)) ?? err.message };
    throw err;
  }
}
