import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 26.11.2026: the language hint each model takes, the file name by format,
// and long audio transcribed part by part and joined in order.

const split = vi.fn();
vi.mock("@/lib/whatsapp-poc/audio-split", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp-poc/audio-split")>();
  return { ...real, splitAudio: (...args: unknown[]) => split(...args) };
});

import { TranscriptionError, fileNameFor, languageFields, transcribeHebrew } from "@/lib/whatsapp-poc/transcribe";

type Sent = { model: string; fields: Array<[string, string]>; name: string; bytes: number };

describe("transcription: what each request carries", () => {
  const sent: Sent[] = [];
  beforeEach(() => {
    sent.length = 0;
    split.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  function stubFetch(answer: (s: Sent, n: number) => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: FormData }) => {
        const form = init.body;
        const file = form.get("file") as File;
        const s: Sent = {
          model: String(form.get("model")),
          fields: [...form.entries()].filter(([k]) => k.startsWith("language")).map(([k, v]) => [k, String(v)]),
          name: file.name,
          bytes: file.size,
        };
        sent.push(s);
        return answer(s, sent.length);
      }),
    );
  }

  it("sends languages[] to gpt-transcribe and language to whisper-1, never both", () => {
    expect(languageFields("gpt-transcribe")).toEqual([["languages[]", "he"]]);
    expect(languageFields("whisper-1")).toEqual([["language", "he"]]);
  });

  it("puts the right field in the request it sends", async () => {
    stubFetch((s) => (s.model === "gpt-transcribe" ? new Response("{}", { status: 400 }) : new Response("שלום", { status: 200 })));
    await transcribeHebrew({ bytes: new ArrayBuffer(8), contentType: "audio/ogg" });
    expect(sent.map((s) => [s.model, s.fields])).toEqual([
      ["gpt-transcribe", [["languages[]", "he"]]],
      ["whisper-1", [["language", "he"]]],
    ]);
  });

  it("names the file by its format: an mp4 voice message is .m4a, not .mp3", () => {
    expect(fileNameFor("audio/mp4")).toBe("audio.m4a");
    expect(fileNameFor("audio/ogg; codecs=opus")).toBe("voice.ogg");
    expect(fileNameFor("audio/mpeg")).toBe("recording.mp3");
    expect(fileNameFor("audio/webm")).toBe("audio.webm");
    expect(fileNameFor("audio/wav")).toBe("audio.wav");
  });

  it("does not split short audio", async () => {
    stubFetch(() => new Response("קצר", { status: 200 }));
    await expect(transcribeHebrew({ bytes: new ArrayBuffer(8), contentType: "audio/ogg" }, { durationSec: 50 })).resolves.toEqual({
      text: "קצר",
      model: "gpt-transcribe",
    });
    expect(split).not.toHaveBeenCalled();
  });

  it("splits a long recording and joins the parts in order", async () => {
    split.mockResolvedValue([1, 2, 3].map((n) => ({ bytes: new ArrayBuffer(n), contentType: "audio/ogg" })));
    stubFetch((s) => new Response(` חלק ${s.bytes} `, { status: 200 }));
    const result = await transcribeHebrew({ bytes: new ArrayBuffer(8), contentType: "audio/mp4" }, { durationSec: 2152 });
    expect(split).toHaveBeenCalledTimes(1);
    expect(sent.map((s) => [s.name, s.bytes])).toEqual([
      ["voice.ogg", 1],
      ["voice.ogg", 2],
      ["voice.ogg", 3],
    ]);
    expect(result).toEqual({ text: "חלק 1\n\nחלק 2\n\nחלק 3", model: "gpt-transcribe" });
  });

  it("splits by size even when the length is unknown", async () => {
    split.mockResolvedValue([{ bytes: new ArrayBuffer(4), contentType: "audio/ogg" }]);
    stubFetch(() => new Response("x", { status: 200 }));
    await transcribeHebrew({ bytes: new ArrayBuffer(24 * 1024 * 1024 + 1), contentType: "audio/mp4" });
    expect(split).toHaveBeenCalledTimes(1);
  });

  it("says so when the split fails, without sending anything", async () => {
    const { AudioSplitError } = await import("@/lib/whatsapp-poc/audio-split");
    split.mockRejectedValue(new AudioSplitError("ffmpeg exited 1: Invalid data"));
    stubFetch(() => new Response("x", { status: 200 }));
    const err = await transcribeHebrew({ bytes: new ArrayBuffer(8), contentType: "audio/mp4" }, { durationSec: 2152 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptionError);
    expect((err as TranscriptionError).code).toBe("comms.transcription.splitFailed");
    expect(sent).toHaveLength(0);
  });

  it("a part that fails fails the whole, so nothing half-done is saved", async () => {
    split.mockResolvedValue([1, 2].map((n) => ({ bytes: new ArrayBuffer(n), contentType: "audio/ogg" })));
    stubFetch((_s, n) => (n === 1 ? new Response("א", { status: 200 }) : new Response("{}", { status: 500 })));
    await expect(transcribeHebrew({ bytes: new ArrayBuffer(8), contentType: "audio/mp4" }, { durationSec: 2152 })).rejects.toThrow(TranscriptionError);
  });
});
