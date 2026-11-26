import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

// Long recordings (26.11.2026). A 35:52 WhatsApp voice message (audio/mp4,
// well over 25MB) was dropped in silence: OpenAI takes at most 25MB a
// request, and the code gave up on anything larger. Here the audio is cut
// into parts that each fit, and the parts are transcribed one by one.
//
// Vercel's functions have no ffmpeg, so the ffmpeg-static binary is shipped
// with the functions that transcribe (next.config.mjs, serverExternalPackages
// and outputFileTracingIncludes). Each part is re-encoded to mono 16kHz Opus
// in Ogg: speech loses nothing a transcript needs, and ten minutes come to
// about 2MB, far under the cap, whatever the source format.

/// OpenAI's own limit for one upload (the transcription guide, read 25.11.2026).
export const OPENAI_MAX_BYTES = 25 * 1024 * 1024;
/// Split above this size, with room under OpenAI's cap.
export const SPLIT_ABOVE_BYTES = 24 * 1024 * 1024;
/// Split above this length too. OpenAI documents no length cap for
/// gpt-transcribe; the gpt-4o-transcribe family had 1500 seconds, and a part
/// this long is also safely inside one function's time.
export const SPLIT_ABOVE_SECONDS = 1400;
/// The length of one part: the length OpenAI's own guide uses for long audio.
export const PART_SECONDS = 600;
const FFMPEG_TIMEOUT_MS = 120_000;

export type Audio = { bytes: ArrayBuffer; contentType: string };

export function needsSplit(audio: { bytes: ArrayBuffer }, durationSec?: number | null): boolean {
  return audio.bytes.byteLength > SPLIT_ABOVE_BYTES || (durationSec ?? 0) > SPLIT_ABOVE_SECONDS;
}

export class AudioSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioSplitError";
  }
}

/// Cut the audio into parts of `partSeconds`, each mono 16kHz Opus in Ogg.
/// The files live in a fresh temporary folder that is removed either way.
export async function splitAudio(audio: Audio, partSeconds = PART_SECONDS): Promise<Audio[]> {
  if (!ffmpegPath) throw new AudioSplitError("ffmpeg is not available on this platform");
  const dir = await mkdtemp(path.join(tmpdir(), "ankora-audio-"));
  try {
    const input = path.join(dir, "input");
    await writeFile(input, Buffer.from(audio.bytes));
    await run(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libopus",
      "-b:a",
      "24k",
      "-f",
      "segment",
      "-segment_time",
      String(partSeconds),
      "-reset_timestamps",
      "1",
      path.join(dir, "part-%03d.ogg"),
    ]);
    const names = (await readdir(dir)).filter((n) => n.startsWith("part-")).sort();
    if (names.length === 0) throw new AudioSplitError("ffmpeg produced no parts");
    const parts: Audio[] = [];
    for (const n of names) {
      const b = await readFile(path.join(dir, n));
      parts.push({ bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, contentType: "audio/ogg" });
    }
    return parts;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      // ffmpeg's own words about the file (format, codec), never content.
      if (stderr.length < 2000) stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new AudioSplitError(`ffmpeg did not finish in ${FFMPEG_TIMEOUT_MS / 1000}s`));
    }, FFMPEG_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new AudioSplitError(`ffmpeg could not start: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new AudioSplitError(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}
