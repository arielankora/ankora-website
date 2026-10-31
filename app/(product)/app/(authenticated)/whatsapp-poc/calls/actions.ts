"use server";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { fetchRecordingAudio } from "@/lib/whatsapp-poc/recordings";
import { TranscriptionError, transcribeHebrew } from "@/lib/whatsapp-poc/transcribe";
import { UnipileError, readPocConfig } from "@/lib/whatsapp-poc/unipile";

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
  const attachmentId = String(formData.get("attachmentId") || "");

  try {
    const audio = await fetchRecordingAudio({ apiKey: config.apiKey, mailAccountId: config.mailAccountId }, emailId, attachmentId);
    if (!audio) return { error: "ההקלטה לא נמצאה." };
    await recordAudit({
      actorId: user.id,
      action: "whatsapp_poc.recording_transcribed",
      entityType: "CallRecording",
      entityId: emailId,
      after: { sizeBytes: audio.bytes.byteLength, model: "whisper-1" },
    });
    const text = await transcribeHebrew(audio);
    return { text: text || "(לא זוהה דיבור)" };
  } catch (err) {
    if (err instanceof UnipileError || err instanceof TranscriptionError) return { error: err.message };
    throw err;
  }
}
