import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionError, transcribeHebrew } from "@/lib/whatsapp-poc/transcribe";

const audio = { bytes: new ArrayBuffer(8), contentType: "audio/ogg; codecs=opus" };

describe("WhatsApp POC: transcription model fallback", () => {
  const sentModels: string[] = [];
  beforeEach(() => {
    sentModels.length = 0;
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  function stubFetch(statusFor: (model: string) => number) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: FormData }) => {
        const model = String(init.body.get("model"));
        sentModels.push(model);
        const status = statusFor(model);
        return new Response(status === 200 ? " שלום " : "{}", { status });
      }),
    );
  }

  it("uses gpt-transcribe when OpenAI accepts it", async () => {
    stubFetch(() => 200);
    await expect(transcribeHebrew(audio)).resolves.toEqual({ text: "שלום", model: "gpt-transcribe" });
    expect(sentModels).toEqual(["gpt-transcribe"]);
  });

  it("falls back to whisper-1 when the newer model is unknown", async () => {
    stubFetch((m) => (m === "gpt-transcribe" ? 404 : 200));
    await expect(transcribeHebrew(audio)).resolves.toEqual({ text: "שלום", model: "whisper-1" });
    expect(sentModels).toEqual(["gpt-transcribe", "whisper-1"]);
  });

  it("does not retry on the spending cap or a bad key", async () => {
    stubFetch(() => 429);
    await expect(transcribeHebrew(audio)).rejects.toThrow(TranscriptionError);
    expect(sentModels).toEqual(["gpt-transcribe"]);
  });

  it("names the file by its format, ogg for voice messages", async () => {
    let name = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: FormData }) => {
        name = (init.body.get("file") as File).name;
        return new Response("x", { status: 200 });
      }),
    );
    await transcribeHebrew(audio);
    expect(name).toBe("voice.ogg");
    await transcribeHebrew({ bytes: new ArrayBuffer(8), contentType: "audio/mpeg" });
    expect(name).toBe("recording.mp3");
  });
});
