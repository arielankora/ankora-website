import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_VOICE_BYTES, fetchVoiceNote } from "@/lib/whatsapp-poc/voice-notes";

// 26.11.2026: a 35:52 voice message (audio/mp4) came back as "no audio"
// because of a 25MB ceiling, with nothing in the log. It is fetched now,
// and each way of finding no audio says which.

const config = { apiKey: "k", accountId: "acc_1" };
const CHAT = "95464254922826@lid";
const MSG = "4ABC0EBD9205B4050C5A";

function stub(attachment: Record<string, unknown> | null, fileBytes: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith(`/messages/${MSG}`)) {
        return Response.json({ id: MSG, timestamp: "2026-11-24T13:38:29.000Z", attachments: attachment ? [attachment] : [] });
      }
      return new Response(new Uint8Array(fileBytes), { status: 200, headers: { "content-type": "audio/mp4" } });
    }),
  );
}

const voice = { id: MSG, type: "audio", mimetype: "audio/mp4", voice_note: true, duration: 2152 };

describe("a voice message's audio from Unipile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches a voice message over the old 25MB ceiling", async () => {
    stub(voice, 30 * 1024 * 1024);
    const audio = await fetchVoiceNote(config, CHAT, MSG);
    expect(audio?.bytes.byteLength).toBe(30 * 1024 * 1024);
    expect(audio?.contentType).toBe("audio/mp4");
  });

  it("logs why there is no audio: too large", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stub(voice, MAX_VOICE_BYTES + 1);
    await expect(fetchVoiceNote(config, CHAT, MSG)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith("voice-note: no audio", expect.objectContaining({ reason: "too-large", bytes: MAX_VOICE_BYTES + 1 }));
  });

  it("logs why there is no audio: no audio attachment, or one WhatsApp no longer has", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stub(null, 10);
    await expect(fetchVoiceNote(config, CHAT, MSG)).resolves.toBeNull();
    stub({ ...voice, is_unavailable: true }, 10);
    await expect(fetchVoiceNote(config, CHAT, MSG)).resolves.toBeNull();
    expect(warn.mock.calls.map((c) => (c[1] as { reason: string }).reason)).toEqual(["no-audio-attachment", "attachment-unavailable"]);
  });
});
