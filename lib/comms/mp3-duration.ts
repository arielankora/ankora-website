// The length of an MP3 in seconds, read from the file itself. Aloha's
// recording emails do not state how long the call was (1.11.2026), and the
// screen and the transcription queue both want it.
//
// Pure and dependency-free: skip an ID3v2 tag, find the first frame header,
// and either read the frame count from a Xing/Info header (variable bit
// rate) or divide the size by the bit rate (constant bit rate). Null when
// the bytes do not look like MP3.

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

export function mp3DurationSeconds(input: ArrayBuffer | Uint8Array): number | null {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let i = 0;
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    i = 10 + size + (b[5] & 0x10 ? 10 : 0);
  }
  // Find a frame sync within the first 64KB after the tag.
  const limit = Math.min(b.length - 4, i + 65536);
  for (; i < limit; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (b[i + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b[i + 1] >> 1) & 0x03; // 1 = Layer III
    const bitrateIndex = (b[i + 2] >> 4) & 0x0f;
    const rateIndex = (b[i + 2] >> 2) & 0x03;
    const channelMode = (b[i + 3] >> 6) & 0x03;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;
    const kbps = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex];
    const sampleRate = SAMPLE_RATES[version][rateIndex];
    const samplesPerFrame = version === 3 ? 1152 : 576;

    // Xing/Info header sits after the side information of the first frame.
    const sideInfo = version === 3 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17;
    const x = i + 4 + sideInfo;
    if (x + 12 <= b.length) {
      const tag = String.fromCharCode(b[x], b[x + 1], b[x + 2], b[x + 3]);
      if ((tag === "Xing" || tag === "Info") && b[x + 7] & 0x01) {
        const frames = ((b[x + 8] << 24) | (b[x + 9] << 16) | (b[x + 10] << 8) | b[x + 11]) >>> 0;
        if (frames > 0) return Math.round((frames * samplesPerFrame) / sampleRate);
      }
    }
    const audioBytes = b.length - i;
    return Math.round((audioBytes * 8) / (kbps * 1000));
  }
  return null;
}
