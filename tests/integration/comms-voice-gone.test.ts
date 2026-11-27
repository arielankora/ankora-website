import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// 27.11.2026: ten voice messages from September and October, loaded with
// the history, are no longer in Unipile (404). The transcription tried each
// again every night, 30 seconds a try, and used its whole budget on them;
// the Drive copy tried them too, 92 seconds. A 404 now marks the voice
// message gone: the transcript fails at once, and the copy skips it.

const fetchVoiceNote = vi.fn();
vi.mock("@/lib/whatsapp-poc/voice-notes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp-poc/voice-notes")>();
  return { ...real, fetchVoiceNote: (...args: unknown[]) => fetchVoiceNote(...args) };
});
const transcribe = vi.fn();
vi.mock("@/lib/whatsapp-poc/transcribe", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp-poc/transcribe")>();
  return { ...real, transcribeHebrew: (...args: unknown[]) => transcribe(...args) };
});
const upload = vi.fn(async () => ({ ok: true, fileId: "drive-new" }));
vi.mock("@/lib/google-drive", () => ({
  uploadLargeFileToDriveFolder: (...args: unknown[]) => upload(...(args as [])),
  downloadFileFromDrive: async () => ({ ok: false }),
  removeDriveFile: async () => ({ ok: true, how: "deleted" }),
}));

import { UnipileError } from "@/lib/whatsapp-poc/unipile";
import { TRANSCRIBE_MAX_ATTEMPTS, transcribePending } from "@/lib/comms/call-store";
import { copyVoiceToDrive } from "@/lib/comms/whatsapp-store";
import { completeDriveCopies } from "@/lib/comms/maintenance";

beforeEach(() => {
  fetchVoiceNote.mockReset();
  transcribe.mockReset();
  upload.mockClear();
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.UNIPILE_API_KEY = "k";
  process.env.GOOGLE_DRIVE_FOLDER_CALL_RECORDINGS = "folder";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function voiceMessage(ownerId: string, externalId: string) {
  const channel = await prisma.commsChannel.create({ data: { accountId: `acc_${externalId}`, ownerUserId: ownerId, storeEnabled: true } });
  const conversation = await prisma.commsConversation.create({
    data: { channelId: channel.id, externalChatId: "dana@lid", name: "דנה" },
  });
  const message = await prisma.commsMessage.create({
    data: {
      conversationId: conversation.id,
      externalId,
      at: new Date("2026-09-07T08:00:00Z"),
      attachments: { create: { externalId, type: "audio", voiceNote: true, durationSec: 12 } },
    },
    include: { attachments: true },
  });
  const transcript = await prisma.transcript.create({ data: { attachmentId: message.attachments[0].id, status: "PENDING" } });
  return { channel, attachment: message.attachments[0], transcript };
}

describe("a voice message Unipile no longer has", () => {
  it("fails its transcript at once, marks it gone, and the queue moves on", async () => {
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    const gone = await voiceMessage(user.id, "3EB0GONE");
    const fine = await voiceMessage(user.id, "3EB0FINE");
    fetchVoiceNote.mockImplementation(async (_config: unknown, _chat: string, messageId: string) => {
      if (messageId === "3EB0GONE") throw new UnipileError("Unipile החזיר שגיאה 404.", 404);
      return { bytes: new ArrayBuffer(8), contentType: "audio/ogg" };
    });
    transcribe.mockResolvedValue({ text: "שלום", model: "gpt-transcribe" });

    expect(await transcribePending({ budgetMs: 60_000 })).toMatchObject({ failed: 1, done: 1, retry: 0 });
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: gone.transcript.id } });
    expect(t).toMatchObject({ status: "FAILED", attempts: TRANSCRIBE_MAX_ATTEMPTS });
    expect((await prisma.commsAttachment.findUniqueOrThrow({ where: { id: gone.attachment.id } })).unavailable).toBe(true);
    expect((await prisma.commsAttachment.findUniqueOrThrow({ where: { id: fine.attachment.id } })).unavailable).toBe(false);

    // The next night does not try it again.
    fetchVoiceNote.mockClear();
    await transcribePending({ budgetMs: 60_000 });
    expect(fetchVoiceNote).not.toHaveBeenCalled();
  });

  it("a different refusal still retries, as before", async () => {
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    const v = await voiceMessage(user.id, "3EB0BUSY");
    fetchVoiceNote.mockRejectedValue(new UnipileError("Unipile החזיר שגיאה 500.", 500));
    expect(await transcribePending({ budgetMs: 60_000 })).toMatchObject({ retry: 1 });
    expect(await prisma.transcript.findUniqueOrThrow({ where: { id: v.transcript.id } })).toMatchObject({ status: "PENDING", attempts: 1 });
    expect((await prisma.commsAttachment.findUniqueOrThrow({ where: { id: v.attachment.id } })).unavailable).toBe(false);
  });

  it("the Drive copy marks it gone on a 404, and the nightly copy skips it after", async () => {
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    const gone = await voiceMessage(user.id, "3EB0GONE");
    fetchVoiceNote.mockRejectedValue(new UnipileError("Unipile החזיר שגיאה 404.", 404));

    await copyVoiceToDrive(gone.channel, "dana@lid", "3EB0GONE", gone.attachment.id);
    expect((await prisma.commsAttachment.findUniqueOrThrow({ where: { id: gone.attachment.id } })).unavailable).toBe(true);

    fetchVoiceNote.mockClear();
    expect(await completeDriveCopies({ budgetMs: 60_000 })).toMatchObject({ voice: 0 });
    expect(fetchVoiceNote).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});
