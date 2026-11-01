"use server";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { fetchRecordingAudio } from "@/lib/whatsapp-poc/recordings";
import { TRANSCRIBE_MODELS, TranscriptionError, transcribeHebrew } from "@/lib/whatsapp-poc/transcribe";
import { UnipileError, isConfigured, readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { fetchVoiceNote } from "@/lib/whatsapp-poc/voice-notes";

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
  if (!canViewWhatsappPoc(user, config.viewers)) return { error: "אין הרשאה." };
  if (!config.apiKey || !config.mailAccountId) return { error: "ההקלטות לא מוגדרות בסביבה הזו." };
  if (!config.hasOpenAiKey) return { error: "התמלול לא מוגדר בסביבה הזו." };

  const emailId = String(formData.get("emailId") || "");

  try {
    const audio = await fetchRecordingAudio({ apiKey: config.apiKey, mailAccountId: config.mailAccountId }, emailId);
    if (!audio) return { error: "ההקלטה לא נמצאה." };
    await recordAudit({
      actorId: user.id,
      action: "whatsapp_poc.recording_transcribed",
      entityType: "CallRecording",
      entityId: emailId,
      after: { sizeBytes: audio.bytes.byteLength, models: TRANSCRIBE_MODELS },
    });
    const { text } = await transcribeHebrew(audio);
    return { text: text || "(לא זוהה דיבור)" };
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
  if (!canViewWhatsappPoc(user, config.viewers)) return { error: "אין הרשאה." };
  if (!isConfigured(config)) return { error: "ה-POC לא מוגדר בסביבה הזו." };
  if (!config.hasOpenAiKey) return { error: "התמלול לא מוגדר בסביבה הזו." };

  const chatId = String(formData.get("chatId") || "");
  const messageId = String(formData.get("messageId") || "");

  try {
    const audio = await fetchVoiceNote(config, chatId, messageId);
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
