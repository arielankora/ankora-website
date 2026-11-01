"use server";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { commsAccess } from "@/lib/comms/access";
import { accountForChatFile } from "@/lib/comms/route-access";
import { fetchRecordingAudio } from "@/lib/whatsapp-poc/recordings";
import { TRANSCRIBE_MODELS, TranscriptionError, transcribeHebrew } from "@/lib/whatsapp-poc/transcribe";
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
  const user = await requireUser();
  const config = readPocConfig();
  if (!(await commsAccess(user)).allowed) return { error: "אין הרשאה." };
  if (!config.apiKey || !config.mailAccountId) return { error: "ההקלטות לא מוגדרות בסביבה הזו." };
  if (!config.hasOpenAiKey) return { error: "התמלול לא מוגדר בסביבה הזו." };

  const emailId = String(formData.get("emailId") || "");

  // 1.11.2026: a stored recording is transcribed on arrival; this button
  // is the retry for one that failed, and its result is saved with it. A
  // number of a client marked "בלי AI" is never sent.
  const stored = await prisma.callRecording.findUnique({ where: { emailId }, include: { transcript: true } });
  if (stored && (await isAiExcludedNumber(stored.otherPhone))) return { error: "הלקוח מסומן \"בלי AI\". ההקלטה לא נשלחת לתמלול." };

  try {
    const audio = stored
      ? await storedRecordingAudio(stored)
      : await fetchRecordingAudio({ apiKey: config.apiKey, mailAccountId: config.mailAccountId }, emailId);
    if (!audio) return { error: "ההקלטה לא נמצאה." };
    await recordAudit({
      actorId: user.id,
      action: "whatsapp_poc.recording_transcribed",
      entityType: "CallRecording",
      entityId: emailId,
      after: { sizeBytes: audio.bytes.byteLength, models: TRANSCRIBE_MODELS },
    });
    const { text, model } = await transcribeHebrew(audio);
    const shown = text || "(לא זוהה דיבור)";
    if (stored?.transcript) {
      await prisma.transcript.update({
        where: { id: stored.transcript.id },
        data: { status: "DONE", text: shown, model, doneAt: new Date(), lastError: null },
      });
    }
    return { text: shown };
  } catch (err) {
    if (err instanceof UnipileError || err instanceof TranscriptionError) return { error: err.message };
    throw err;
  }
}

// The same, for a WhatsApp voice message in the chat view.
export async function transcribeVoiceNoteAction(
  _prev: TranscribeState | undefined,
  formData: FormData,
): Promise<TranscribeState> {
  const user = await requireUser();
  const config = readPocConfig();
  if (!config.hasOpenAiKey) return { error: "התמלול לא מוגדר בסביבה הזו." };

  const chatId = String(formData.get("chatId") || "");
  const messageId = String(formData.get("messageId") || "");
  // The chat's own number, checked like the audio route (several numbers).
  const unipile = await accountForChatFile(user, String(formData.get("numberKey") || "-"), chatId);
  if (!unipile) return { error: "אין הרשאה." };

  try {
    const audio = await fetchVoiceNote(unipile, chatId, messageId);
    if (!audio) return { error: "ההודעה הקולית לא נמצאה." };
    await recordAudit({
      actorId: user.id,
      action: "whatsapp_poc.voice_note_transcribed",
      entityType: "WhatsAppChat",
      entityId: chatId,
      after: { messageId, sizeBytes: audio.bytes.byteLength, models: TRANSCRIBE_MODELS },
    });
    const { text } = await transcribeHebrew(audio);
    return { text: text || "(לא זוהה דיבור)" };
  } catch (err) {
    if (err instanceof UnipileError || err instanceof TranscriptionError) return { error: err.message };
    throw err;
  }
}
