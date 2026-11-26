import "server-only";
import { DomainError, type DomainErrorValues } from "@/lib/domain-error";
import { AudioSplitError, OPENAI_MAX_BYTES, needsSplit, splitAudio } from "./audio-split";

// WhatsApp POC, stage 2: Hebrew transcription of a call recording with
// OpenAI (Ariel's choice, 31.10.2026; model per TRANSCRIBE_MODELS below).
//
// Sending a recording here sends a client's voice to a new sub-processor,
// so it happens only when a person presses the button, and only when
// OPENAI_API_KEY is set (which waits on a DPA with OpenAI). The transcript
// is returned to the screen and not stored.

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
/// OpenAI's own limit for one upload (longer audio is split, audio-split.ts).
export const MAX_AUDIO_BYTES = OPENAI_MAX_BYTES;
const TIMEOUT_MS = 120_000;

/// What a transcript says when OpenAI heard no speech. It is stored as the
/// transcript's text and read as the transcript, so it is content and stays
/// in Hebrew (ADR 0006).
export const NO_SPEECH_TRANSCRIPT = "(לא זוהה דיבור)";

/// The message keeps the Hebrew sentence it always had (it is stored as a
/// transcript's lastError); the code lets a screen word it (ADR 0006,
/// domainErrors.comms.transcription.*).
export class TranscriptionError extends DomainError {
  /// OpenAI's status when it answered (429 = the cap or a rate limit), or
  /// null when it did not, or nothing was sent.
  constructor(
    message: string,
    readonly status: number | null = null,
    code = "comms.transcription.failed",
    values: DomainErrorValues = {},
  ) {
    super(code, message, values);
    this.name = "TranscriptionError";
  }
}

/// 1.11.2026: OpenAI's pricing page lists gpt-transcribe as the current
/// model ($0.0045 a minute) and marks whisper-1 deprecated. The newer name
/// was read off that page and not yet tried, so whisper-1 stays as the
/// fallback: if OpenAI does not know the model (400 or 404), the same file
/// goes to whisper-1 rather than the button failing.
export const TRANSCRIBE_MODELS = ["gpt-transcribe", "whisper-1"] as const;

/// The language hint each model takes (OpenAI's speech-to-text guide, read
/// 25.11.2026): "For gpt-transcribe, languages replaces the singular
/// language field. Don't send both fields." The older models take language.
export function languageFields(model: string): Array<[string, string]> {
  return model === "gpt-transcribe" ? [["languages[]", "he"]] : [["language", "he"]];
}

/// OpenAI reads the format from the file name. 26.11.2026: a long WhatsApp
/// voice message came as audio/mp4, which was named .mp3.
export function fileNameFor(contentType: string): string {
  const t = contentType.toLowerCase();
  if (t.includes("ogg") || t.includes("opus")) return "voice.ogg";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "audio.m4a";
  if (t.includes("webm")) return "audio.webm";
  if (t.includes("wav")) return "audio.wav";
  return "recording.mp3";
}

/// Transcribe in Hebrew. Audio over OpenAI's 25MB, or longer than
/// SPLIT_ABOVE_SECONDS when its length is known, is cut into parts that are
/// transcribed in order and joined (audio-split.ts).
export async function transcribeHebrew(
  audio: { bytes: ArrayBuffer; contentType: string },
  options: { durationSec?: number | null } = {},
): Promise<{ text: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new TranscriptionError("התמלול לא מוגדר בסביבה הזו.", null, "comms.transcription.notConfigured");
  if (!needsSplit(audio, options.durationSec)) return transcribeOne(apiKey, audio);

  let parts: Awaited<ReturnType<typeof splitAudio>>;
  try {
    parts = await splitAudio(audio);
  } catch (err) {
    const why = err instanceof AudioSplitError ? err.message : String(err);
    console.error("transcribe: split failed", { bytes: audio.bytes.byteLength, contentType: audio.contentType, why });
    throw new TranscriptionError(`לא הצלחנו לחלק את ההקלטה הארוכה למקטעים (${why}).`, null, "comms.transcription.splitFailed");
  }
  console.log("transcribe: split", { bytes: audio.bytes.byteLength, contentType: audio.contentType, parts: parts.length });
  const texts: string[] = [];
  const models = new Set<string>();
  for (const part of parts) {
    const { text, model } = await transcribeOne(apiKey, part);
    if (text) texts.push(text);
    models.add(model);
  }
  return { text: texts.join("\n\n"), model: [...models].join(",") };
}

async function transcribeOne(apiKey: string, audio: { bytes: ArrayBuffer; contentType: string }): Promise<{ text: string; model: string }> {
  if (audio.bytes.byteLength > MAX_AUDIO_BYTES) throw new TranscriptionError("ההקלטה גדולה מ-25MB, מעל המגבלה של OpenAI.", null, "comms.transcription.tooLarge");
  const name = fileNameFor(audio.contentType);

  let lastStatus = 0;
  const refused: string[] = [];
  for (const model of TRANSCRIBE_MODELS) {
    const form = new FormData();
    form.set("file", new Blob([audio.bytes], { type: audio.contentType }), name);
    form.set("model", model);
    for (const [key, value] of languageFields(model)) form.append(key, value);
    form.set("response_format", "text");

    // 25.11.2026: a line per attempt (sizes and codes only, never the audio
    // or the text), so a failure can be read in the log without the
    // database. A voice message stuck "in the queue" since 24.11 failed
    // with nothing written anywhere but the transcript's lastError.
    const started = Date.now();
    const meta = { model, bytes: audio.bytes.byteLength, contentType: audio.contentType };
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      console.error("transcribe: no answer", { ...meta, timedOut, seconds: secondsSince(started) });
      throw new TranscriptionError(timedOut ? `OpenAI לא ענה תוך ${TIMEOUT_MS / 1000} שניות (${model}).` : `OpenAI לא ענה (${model}).`, null, "comms.transcription.noAnswer");
    }
    if (response.ok) {
      if (refused.length) console.warn("transcribe: fell back", { ...meta, refused });
      console.log("transcribe: done", { ...meta, seconds: secondsSince(started) });
      return { text: (await response.text()).trim(), model };
    }
    lastStatus = response.status;
    const error = await readOpenAiError(response);
    refused.push(describeRefusal(model, response.status, error));
    console.error("transcribe: refused", { ...meta, status: response.status, ...error, seconds: secondsSince(started) });
    // Only an unknown or refused model moves on to the next one. A spending
    // cap, a bad key or an overload is the same for every model.
    if (response.status !== 400 && response.status !== 404) break;
  }
  if (lastStatus === 429) throw new TranscriptionError("OpenAI מגביל את הבקשות, או שהגענו לתקרת ההוצאה החודשית.", 429, "comms.transcription.rateLimited");
  if (lastStatus === 401 || lastStatus === 403) throw new TranscriptionError("OpenAI דחה את המפתח.", lastStatus, "comms.transcription.keyRejected");
  // The refusals ride along in the message, which is what lastError keeps.
  throw new TranscriptionError(`OpenAI החזיר שגיאה ${lastStatus}. ${refused.join("; ")}`.trim(), lastStatus, "comms.transcription.status", { status: String(lastStatus) });
}

function secondsSince(start: number): number {
  return Math.round((Date.now() - start) / 100) / 10;
}

/// What OpenAI says when it refuses: its error type, code, the parameter it
/// names, and the first words of its message. OpenAI's error messages name
/// parameters and limits, not what was said in the recording.
export type OpenAiRefusal = { type: string | null; code: string | null; param: string | null; message: string | null };

export async function readOpenAiError(response: Response): Promise<OpenAiRefusal> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (a proxy page, an empty body): nothing more to say.
  }
  const e = (body as { error?: Record<string, unknown> } | null)?.error ?? {};
  const str = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);
  return { type: str(e.type, 60), code: str(e.code, 60), param: str(e.param, 60), message: str(e.message, 200) };
}

/// One refusal, short, for lastError: "gpt-transcribe 400 invalid_value language".
export function describeRefusal(model: string, status: number, e: OpenAiRefusal): string {
  return [model, String(status), e.code ?? e.type, e.param, e.message ? `"${e.message}"` : null].filter(Boolean).join(" ");
}
