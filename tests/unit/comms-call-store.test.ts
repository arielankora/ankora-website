import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { mp3DurationSeconds } from "@/lib/comms/mp3-duration";
import { parseSignatureHeader, verifyUnipileSignature } from "@/lib/comms/webhook-signature";

// A minimal MPEG-1 Layer III stream: frame header FF FB 90 64 = 128 kbps,
// 44.1 kHz, joint stereo. Constant bit rate, so length = bytes * 8 / bitrate.
function cbrFrames(bytes: number): Uint8Array {
  const b = new Uint8Array(bytes);
  b.set([0xff, 0xfb, 0x90, 0x64], 0);
  return b;
}

describe("mp3DurationSeconds", () => {
  it("reads a constant bit rate file from its size", () => {
    expect(mp3DurationSeconds(cbrFrames(16000 * 60))).toBe(60);
  });

  it("skips an ID3v2 tag before the first frame", () => {
    const audio = cbrFrames(16000 * 10);
    const tag = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0)]);
    const all = new Uint8Array(tag.length + audio.length);
    all.set(tag, 0);
    all.set(audio, tag.length);
    expect(mp3DurationSeconds(all)).toBe(10);
  });

  it("uses the frame count of a Xing header when there is one", () => {
    const b = cbrFrames(4000);
    const x = 4 + 32; // after the side information of a stereo MPEG-1 frame
    b.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 0x01], x); // "Xing", flags: frames
    const frames = 2297; // 2297 * 1152 / 44100 = 60 seconds
    b.set([(frames >>> 24) & 0xff, (frames >>> 16) & 0xff, (frames >>> 8) & 0xff, frames & 0xff], x + 8);
    expect(mp3DurationSeconds(b)).toBe(60);
  });

  it("answers null for bytes that are not MP3", () => {
    expect(mp3DurationSeconds(new TextEncoder().encode("not audio at all"))).toBeNull();
  });
});

describe("verifyUnipileSignature", () => {
  const secret = "s3cr3t";
  const body = '{"type":"email.new"}';
  const sign = (t: number, b = body) => crypto.createHmac("sha256", secret).update(`${t}.${b}`).digest("hex");

  it("accepts a fresh delivery signed with the secret", () => {
    const t = 1_800_000_000;
    expect(verifyUnipileSignature({ header: `t=${t},v0=${sign(t)}`, rawBody: body, secret, nowSeconds: t + 10 })).toBe(true);
  });

  it("refuses a changed body, a wrong secret, an old delivery and a bad header", () => {
    const t = 1_800_000_000;
    const header = `t=${t},v0=${sign(t)}`;
    expect(verifyUnipileSignature({ header, rawBody: body + " ", secret, nowSeconds: t })).toBe(false);
    expect(verifyUnipileSignature({ header, rawBody: body, secret: "other", nowSeconds: t })).toBe(false);
    expect(verifyUnipileSignature({ header, rawBody: body, secret, nowSeconds: t + 301 })).toBe(false);
    expect(verifyUnipileSignature({ header: null, rawBody: body, secret, nowSeconds: t })).toBe(false);
    expect(parseSignatureHeader("t=abc,v0=zz")).toBeNull();
  });
});
