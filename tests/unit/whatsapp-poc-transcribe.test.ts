import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionError, describeRefusal, readOpenAiError, transcribeHebrew } from "@/lib/whatsapp-poc/transcribe";

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

// 25.11.2026: a voice message stuck "in the queue" failed with nothing in
// the log. Each refusal now says which model, the status and OpenAI's own
// code, in the log and in the message kept as lastError.
describe("WhatsApp POC: what a refusal leaves behind", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  const refusal = (param: string) =>
    JSON.stringify({ error: { message: `Unsupported parameter: ${param}`, type: "invalid_request_error", param, code: "unsupported_parameter" } });

  it("reads OpenAI's error body, and survives one that is not JSON", async () => {
    await expect(readOpenAiError(new Response(refusal("language"), { status: 400 }))).resolves.toEqual({
      type: "invalid_request_error",
      code: "unsupported_parameter",
      param: "language",
      message: "Unsupported parameter: language",
    });
    await expect(readOpenAiError(new Response("<html>", { status: 502 }))).resolves.toEqual({ type: null, code: null, param: null, message: null });
  });

  it("describes a refusal in one short line", () => {
    expect(describeRefusal("gpt-transcribe", 400, { type: "invalid_request_error", code: "unsupported_parameter", param: "language", message: null })).toBe(
      "gpt-transcribe 400 unsupported_parameter language",
    );
  });

  it("keeps every model's refusal in the error, and logs each one", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(refusal("language"), { status: 400 })));
    const err = await transcribeHebrew(audio).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptionError);
    expect((err as TranscriptionError).message).toContain("gpt-transcribe 400 unsupported_parameter language");
    expect((err as TranscriptionError).message).toContain("whisper-1 400");
    const refused = errors.mock.calls.filter((c) => c[0] === "transcribe: refused");
    expect(refused.map((c) => (c[1] as { model: string }).model)).toEqual(["gpt-transcribe", "whisper-1"]);
    // Sizes and codes only: the line never carries the audio.
    expect(Object.keys(refused[0][1] as object).sort()).toEqual(["bytes", "code", "contentType", "message", "model", "param", "seconds", "status", "type"]);
  });

  it("logs a silent fall back to whisper-1", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: FormData }) =>
        init.body.get("model") === "gpt-transcribe" ? new Response(refusal("language"), { status: 400 }) : new Response("שלום", { status: 200 }),
      ),
    );
    await expect(transcribeHebrew(audio)).resolves.toEqual({ text: "שלום", model: "whisper-1" });
    expect(warn).toHaveBeenCalledWith("transcribe: fell back", expect.objectContaining({ model: "whisper-1", refused: ["gpt-transcribe 400 unsupported_parameter language \"Unsupported parameter: language\""] }));
  });

  it("says when OpenAI did not answer in time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }));
    await expect(transcribeHebrew(audio)).rejects.toThrow("OpenAI לא ענה תוך 120 שניות (gpt-transcribe).");
  });
});
