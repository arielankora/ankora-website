import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// 27.11.2026: the WhatsApp history load checks its budget between messages,
// not only between chats. One chat of 90 messages kept the nightly step at
// 205 seconds against a 10-second share, and the steps after it got no time.
// A chat cut short is not marked loaded, and the next night finishes it
// without storing anything twice.

const CHAT = { id: "dana@lid", name: "דנה", type: "1to1", phone: "+972542222222" };
const messages = Array.from({ length: 5 }, (_, i) => ({
  id: `m${i}`,
  text: `הודעה ${i}`,
  timestamp: `2026-11-01T08:0${i}:00.000Z`,
  isSender: false,
  senderName: null,
  isDeleted: false,
  attachments: [],
  quoted: null,
}));

vi.mock("@/lib/whatsapp-poc/unipile", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp-poc/unipile")>();
  return {
    ...real,
    loadMergedChats: async () => ({ chats: [CHAT] }),
    listMessages: async () => messages,
    getChat: async () => CHAT,
  };
});
vi.mock("@/lib/google-drive", () => ({
  uploadLargeFileToDriveFolder: async () => ({ ok: true, fileId: "drive-1" }),
  downloadFileFromDrive: async () => ({ ok: true, body: new ArrayBuffer(8) }),
  removeDriveFile: async () => ({ ok: true, how: "deleted" }),
}));

import { backfillChannel } from "@/lib/comms/whatsapp-store";

beforeEach(() => {
  process.env.UNIPILE_API_KEY = "k";
});

describe("WhatsApp history load: the budget holds inside a chat", () => {
  it("stops mid-chat when the time is up, and finishes the chat the next night", async () => {
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    const channel = await prisma.commsChannel.create({ data: { accountId: "acc_h", ownerUserId: user.id, storeEnabled: true } });

    // A clock that moves 10 seconds a reading: past a 25-second budget after
    // the first messages.
    let t = 0;
    const clock = () => (t += 10_000);
    const first = await backfillChannel(channel, { budgetMs: 25_000, now: clock });
    expect(first.stoppedBy).toBe("budget");
    expect(first.messages).toBeGreaterThan(0);
    expect(first.messages).toBeLessThan(messages.length);
    const conversation = await prisma.commsConversation.findFirstOrThrow({ where: { channelId: channel.id } });
    expect(conversation.backfilledAt).toBeNull();

    const second = await backfillChannel(channel, { budgetMs: 600_000 });
    expect(second).toMatchObject({ stoppedBy: "done", chats: 1, messages: messages.length - first.messages });
    expect(await prisma.commsMessage.count({ where: { conversationId: conversation.id } })).toBe(messages.length);
    expect((await prisma.commsConversation.findUniqueOrThrow({ where: { id: conversation.id } })).backfilledAt).not.toBeNull();
  });
});
