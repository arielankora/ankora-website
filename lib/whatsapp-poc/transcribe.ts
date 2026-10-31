import "server-only";

// WhatsApp POC, stage 2: Hebrew transcription of a call recording with
// OpenAI Whisper (Ariel's choice, 31.10.2026).
//
// Sending a recording here sends a client's voice to a new sub-processor,
// so it happens only when a person presses the button, and only when
// OPENAI_API_KEY is set (which waits on a DPA with OpenAI). The transcript
// is returned to the screen and not stored.

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
/// OpenAI's own limit for one upload.
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export async function transcribeHebrew(audio: { bytes: ArrayBuffer; contentType: string }): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new TranscriptionError("התמלול לא מוגדר בסביבה הזו.");
  if (audio.bytes.byteLength > MAX_AUDIO_BYTES) throw new TranscriptionError("ההקלטה גדולה מ-25MB, מעל המגבלה של OpenAI.");

  const form = new FormData();
  form.set("file", new Blob([audio.bytes], { type: audio.contentType }), "recording.mp3");
  form.set("model", "whisper-1");
  form.set("language", "he");
  form.set("response_format", "text");

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new TranscriptionError("OpenAI לא ענה.");
  }
  if (!response.ok) throw new TranscriptionError(`OpenAI החזיר שגיאה ${response.status}.`);
  return (await response.text()).trim();
}
