import "server-only";

// WhatsApp POC, stage 2: Hebrew transcription of a call recording with
// OpenAI (Ariel's choice, 31.10.2026; model per TRANSCRIBE_MODELS below).
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
  /// OpenAI's status when it answered (429 = the cap or a rate limit), or
  /// null when it did not, or nothing was sent.
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

/// 1.11.2026: OpenAI's pricing page lists gpt-transcribe as the current
/// model ($0.0045 a minute) and marks whisper-1 deprecated. The newer name
/// was read off that page and not yet tried, so whisper-1 stays as the
/// fallback: if OpenAI does not know the model (400 or 404), the same file
/// goes to whisper-1 rather than the button failing.
export const TRANSCRIBE_MODELS = ["gpt-transcribe", "whisper-1"] as const;

export async function transcribeHebrew(audio: {
  bytes: ArrayBuffer;
  contentType: string;
}): Promise<{ text: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new TranscriptionError("התמלול לא מוגדר בסביבה הזו.");
  if (audio.bytes.byteLength > MAX_AUDIO_BYTES) throw new TranscriptionError("ההקלטה גדולה מ-25MB, מעל המגבלה של OpenAI.");

  // OpenAI reads the format from the file name: WhatsApp voice messages
  // are Ogg Opus, Aloha's recordings are MP3.
  const name = audio.contentType.includes("ogg") ? "voice.ogg" : "recording.mp3";

  let lastStatus = 0;
  for (const model of TRANSCRIBE_MODELS) {
    const form = new FormData();
    form.set("file", new Blob([audio.bytes], { type: audio.contentType }), name);
    form.set("model", model);
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
    if (response.ok) return { text: (await response.text()).trim(), model };
    lastStatus = response.status;
    // Only an unknown or refused model moves on to the next one. A spending
    // cap, a bad key or an overload is the same for every model.
    if (response.status !== 400 && response.status !== 404) break;
  }
  if (lastStatus === 429) throw new TranscriptionError("OpenAI מגביל את הבקשות, או שהגענו לתקרת ההוצאה החודשית.", 429);
  if (lastStatus === 401 || lastStatus === 403) throw new TranscriptionError("OpenAI דחה את המפתח.", lastStatus);
  throw new TranscriptionError(`OpenAI החזיר שגיאה ${lastStatus}.`, lastStatus);
}
