import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// Stage 3 (1.11.2026): WhatsApp messages are kept only after "התחל לשמור",
// a blocked number is dropped, a manager's block deletes what was kept, an
// employee's block holds the messages until a manager decides. Unipile and
// Drive are replaced; the database is real.

vi.mock("@/lib/whatsapp-poc/unipile", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp-poc/unipile")>();
  return {
    ...real,
    getChat: async (_c: unknown, chatId: string) => ({
      id: chatId,
      name: chatId === "family@lid" ? "אמא" : "דנה",
      type: "1to1",
      phone: chatId === "family@lid" ? "+972541111111" : "+972542222222",
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
    }),
  };
});
vi.mock("@/lib/google-drive", () => ({
  uploadLargeFileToDriveFolder: async () => ({ ok: true, fileId: "drive-1" }),
  downloadFileFromDrive: async () => ({ ok: true, body: new ArrayBuffer(8) }),
  removeDriveFile: async () => ({ ok: true, how: "deleted" }),
}));
vi.mock("@/lib/whatsapp-poc/voice-notes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp-poc/voice-notes")>();
  return { ...real, fetchVoiceNote: async () => ({ bytes: new ArrayBuffer(8), contentType: "audio/ogg" }) };
});

import { decideBlock, requestBlock, storeMessage } from "@/lib/comms/whatsapp-store";

function msg(id: string, text = "שלום") {
  return { id, text, timestamp: "2026-11-01T08:00:00.000Z", isSender: false, senderName: null, isDeleted: false, attachments: [] };
}

beforeEach(() => {
  process.env.UNIPILE_API_KEY = "k";
});

async function setup(storeEnabled = true) {
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const channel = await prisma.commsChannel.create({ data: { accountId: "acc_wa", ownerUserId: anna.id, storeEnabled } });
  return { ariel, anna, channel };
}

describe("WhatsApp store", () => {
  it("keeps nothing before התחל לשמור", async () => {
    const { channel } = await setup(false);
    expect(await storeMessage(channel, "dana@lid", msg("m1"))).toBe("not-stored");
    expect(await prisma.commsMessage.count()).toBe(0);
  });

  it("keeps a message once", async () => {
    const { channel } = await setup();
    expect(await storeMessage(channel, "dana@lid", msg("m1"))).toBe("stored");
    expect(await storeMessage(channel, "dana@lid", msg("m1"))).toBe("exists");
    const conv = await prisma.commsConversation.findFirstOrThrow();
    expect(conv).toMatchObject({ otherPhone: "+972542222222", name: "דנה" });
  });

  it("a manager's block deletes what was kept and drops what comes next", async () => {
    const { ariel, channel } = await setup();
    await storeMessage(channel, "family@lid", msg("m1"));
    const { deleted } = await requestBlock(ariel, { channelId: channel.id, kind: "PHONE", value: "+972541111111", label: "אמא" });
    expect(deleted).toBe(1);
    expect(await prisma.commsMessage.count()).toBe(0);
    expect(await storeMessage(channel, "family@lid", msg("m2"))).toBe("blocked");
    expect(await prisma.commsMessage.count()).toBe(0);
  });

  it("an employee's block holds the messages until a manager decides", async () => {
    const { ariel, anna, channel } = await setup();
    await storeMessage(channel, "family@lid", msg("m1"));
    const { block } = await requestBlock(anna, { channelId: channel.id, kind: "PHONE", value: "+972541111111", label: "אמא" });
    expect(block.status).toBe("PENDING");
    expect((await prisma.commsMessage.findFirstOrThrow()).held).toBe(true);
    await storeMessage(channel, "family@lid", msg("m2"));
    expect(await prisma.commsMessage.count({ where: { held: true } })).toBe(2);

    await decideBlock(ariel, block.id, false);
    expect(await prisma.commsMessage.count({ where: { held: true } })).toBe(0);

    const again = await requestBlock(anna, { channelId: channel.id, kind: "PHONE", value: "+972541111111", label: "אמא" });
    await expect(decideBlock(anna, again.block.id, true)).rejects.toThrow("רק מנהל");
    await decideBlock(ariel, again.block.id, true);
    expect(await prisma.commsMessage.count()).toBe(0);
  });
});
