import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { SPLIT_ABOVE_BYTES, SPLIT_ABOVE_SECONDS, needsSplit, splitAudio } from "@/lib/whatsapp-poc/audio-split";

// 26.11.2026: a 35:52 voice message (audio/mp4, over 25MB) was dropped in
// silence. Long audio is now cut into parts with the ffmpeg-static binary;
// this runs the real binary on a real file.

function tone(seconds: number, format: "mp4" | "ogg"): ArrayBuffer {
  const dir = mkdtempSync(path.join(tmpdir(), "split-test-"));
  try {
    const out = path.join(dir, format === "mp4" ? "a.m4a" : "a.ogg");
    execFileSync(ffmpegPath!, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
      ...(format === "mp4" ? ["-c:a", "aac"] : ["-c:a", "libopus"]),
      out,
    ]);
    const b = readFileSync(out);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("long audio: when to split", () => {
  it("splits above the size or the length, not below", () => {
    expect(needsSplit({ bytes: new ArrayBuffer(1000) }, 60)).toBe(false);
    expect(needsSplit({ bytes: new ArrayBuffer(1000) }, null)).toBe(false);
    expect(needsSplit({ bytes: new ArrayBuffer(SPLIT_ABOVE_BYTES + 1) }, 60)).toBe(true);
    expect(needsSplit({ bytes: new ArrayBuffer(1000) }, SPLIT_ABOVE_SECONDS + 1)).toBe(true);
    // The voice message that started this: 35:52.
    expect(needsSplit({ bytes: new ArrayBuffer(1000) }, 2152)).toBe(true);
  });
});

describe("long audio: the split itself", () => {
  it("cuts an audio/mp4 file into Ogg parts of the given length", async () => {
    const parts = await splitAudio({ bytes: tone(5, "mp4"), contentType: "audio/mp4" }, 2);
    expect(parts.length).toBe(3);
    for (const p of parts) {
      expect(p.contentType).toBe("audio/ogg");
      expect(Buffer.from(p.bytes).subarray(0, 4).toString("latin1")).toBe("OggS");
    }
  });

  it("cuts Ogg Opus too", async () => {
    const parts = await splitAudio({ bytes: tone(3, "ogg"), contentType: "audio/ogg; codecs=opus" }, 2);
    expect(parts.length).toBe(2);
  });

  it("refuses what is not audio, with ffmpeg's reason", async () => {
    await expect(splitAudio({ bytes: new TextEncoder().encode("not audio").buffer as ArrayBuffer, contentType: "audio/mp4" })).rejects.toThrow(
      /ffmpeg exited/,
    );
  });
});
