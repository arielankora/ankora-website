import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// 27.11.2026: a voice message in a group with two of our numbers (or sent
// from one of our numbers to another) is stored once per number. It was
// sent to OpenAI once per number; now the first one stored is transcribed
// and the others copy its text.

const transcribe = vi.fn();
vi.mock("@/lib/whatsapp-poc/transcribe", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp-poc/transcribe")>();
  return { ...real, transcribeHebrew: (...args: unknown[]) => transcribe(...args) };
});
vi.mock("@/lib/google-drive", () => ({
  uploadLargeFileToDriveFolder: async () => ({ ok: true, fileId: "drive-1" }),
  downloadFileFromDrive: async () => ({ ok: true, body: new ArrayBuffer(8) }),
  removeDriveFile: async () => ({ ok: true, how: "deleted" }),
}));

import { transcribePending, transcribeRecording } from "@/lib/comms/call-store";

beforeEach(() => {
  transcribe.mockReset();
  process.env.OPENAI_API_KEY = "sk-test";
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/// The same WhatsApp voice message (same message id and attachment id),
/// stored on one of our numbers.
async function storedOn(accountId: string, ownerId: string, createdAt: Date, opts: { held?: boolean } = {}) {
  const channel = await prisma.commsChannel.create({ data: { accountId, ownerUserId: ownerId, storeEnabled: true } });
  const conversation = await prisma.commsConversation.create({
    data: { channelId: channel.id, externalChatId: "group@g.us", isGroup: true, name: "קבוצה" },
  });
  const message = await prisma.commsMessage.create({
    data: {
      conversationId: conversation.id,
      externalId: "3EB0ABCDEF",
      at: new Date("2026-11-26T08:53:00Z"),
      held: opts.held ?? false,
      attachments: { create: { externalId: "3EB0ABCDEF", type: "audio", voiceNote: true, durationSec: 27, driveFileId: "drive-x" } },
    },
    include: { attachments: true },
  });
  return prisma.transcript.create({ data: { attachmentId: message.attachments[0].id, status: "PENDING", createdAt } });
}

describe("one voice message on two of our numbers", () => {
  it("transcribes it once: the first stored is sent, the other copies its text", async () => {
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    const first = await storedOn("acc_a", user.id, new Date("2026-11-26T08:53:22.302Z"));
    const second = await storedOn("acc_b", user.id, new Date("2026-11-26T08:53:22.320Z"));
    transcribe.mockResolvedValue({ text: "שלום לכולם", model: "gpt-transcribe" });

    // The webhooks race: the second number's arrives first and waits.
    expect(await transcribeRecording(second.id)).toBe("waiting");
    expect(await transcribeRecording(first.id)).toBe("done");
    expect(await transcribeRecording(second.id)).toBe("copied");

    expect(transcribe).toHaveBeenCalledTimes(1);
    const both = await prisma.transcript.findMany({ where: { id: { in: [first.id, second.id] } } });
    expect(both.map((t) => [t.status, t.text, t.model])).toEqual([
      ["DONE", "שלום לכולם", "gpt-transcribe"],
      ["DONE", "שלום לכולם", "gpt-transcribe"],
    ]);
  });

  it("the nightly run, oldest first, sends it once and copies it in the same run", async () => {
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    await storedOn("acc_a", user.id, new Date("2026-11-26T08:53:22.302Z"));
    await storedOn("acc_b", user.id, new Date("2026-11-26T08:53:22.320Z"));
    transcribe.mockResolvedValue({ text: "שלום", model: "gpt-transcribe" });

    expect(await transcribePending({ budgetMs: 60_000 })).toMatchObject({ done: 1, copied: 1 });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a twin held by a block request, or one that failed", async () => {
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    const held = await storedOn("acc_a", user.id, new Date("2026-11-26T08:53:22.302Z"), { held: true });
    const mine = await storedOn("acc_b", user.id, new Date("2026-11-26T08:53:22.320Z"));
    transcribe.mockResolvedValue({ text: "שלום", model: "gpt-transcribe" });
    expect(await transcribeRecording(mine.id)).toBe("done");

    await prisma.transcript.update({ where: { id: held.id }, data: { status: "FAILED", attempts: 3 } });
    await prisma.commsMessage.updateMany({ data: { held: false } });
    await prisma.transcript.update({ where: { id: mine.id }, data: { status: "PENDING", text: null } });
    // The failed twin has no text: this one is transcribed again, not stuck.
    expect(await transcribeRecording(mine.id)).toBe("done");
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("leaves a voice message on one number alone", async () => {
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    const only = await storedOn("acc_a", user.id, new Date());
    transcribe.mockResolvedValue({ text: "x", model: "gpt-transcribe" });
    expect(await transcribeRecording(only.id)).toBe("done");
  });
});
