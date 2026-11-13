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
    // A reaction's fresh count is not read here: the count goes by one.
    getMessage: async () => {
      throw new real.UnipileError("quota", 429);
    },
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

import { decideBlock, deleteStoredMessage, enrichStoredMessage, requestBlock, storeMessage, updateStoredMessage } from "@/lib/comms/whatsapp-store";
import { listStoredMessages } from "@/lib/comms/stored-chats";

function msg(id: string, text = "שלום") {
  return { id, text, timestamp: "2026-11-01T08:00:00.000Z", isSender: false, senderName: null, isDeleted: false, attachments: [], quoted: null };
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

  it("keeps the message a reply answers, and drops its text when that one is deleted", async () => {
    const { channel } = await setup();
    await storeMessage(channel, "dana@lid", msg("orig", "נעלנו לעזור לקבלנים שלנו"));
    const reply = { ...msg("r1", "."), quoted: { id: "orig", text: "נעלנו לעזור לקבלנים שלנו", senderName: "דנה", kind: null } };
    expect(await storeMessage(channel, "dana@lid", reply)).toBe("stored");
    expect(await prisma.commsMessage.findFirstOrThrow({ where: { externalId: "r1" } })).toMatchObject({
      quotedExternalId: "orig",
      quotedText: "נעלנו לעזור לקבלנים שלנו",
      quotedSenderName: "דנה",
    });

    // A reply kept before quotes were kept gets its quote when it comes again.
    await storeMessage(channel, "dana@lid", msg("r2", "כן"));
    await storeMessage(channel, "dana@lid", { ...msg("r2", "כן"), quoted: { id: "orig", text: "נעלנו", senderName: null, kind: null } });
    expect((await prisma.commsMessage.findFirstOrThrow({ where: { externalId: "r2" } })).quotedExternalId).toBe("orig");

    // 13.11.2026 (Ariel): a deletion in WhatsApp marks, and erases nothing.
    await storeMessage(channel, "dana@lid", msg("orig", "נעלנו לעזור לקבלנים שלנו"));
    expect(await deleteStoredMessage(channel, "dana@lid", "orig")).toBe(true);
    expect(await prisma.commsMessage.findFirstOrThrow({ where: { externalId: "orig" } })).toMatchObject({
      isDeleted: true,
      text: "נעלנו לעזור לקבלנים שלנו",
    });
    const after = await prisma.commsMessage.findMany({ where: { quotedExternalId: "orig" }, orderBy: { externalId: "asc" } });
    expect(after.map((m) => m.quotedText)).toEqual(["נעלנו לעזור לקבלנים שלנו", "נעלנו"]);

    // The same when the deletion comes as an update with the text emptied.
    await updateStoredMessage(channel, "dana@lid", { ...msg("r1", ""), isDeleted: true });
    expect(await prisma.commsMessage.findFirstOrThrow({ where: { externalId: "r1" } })).toMatchObject({ isDeleted: true, text: ".", isEdited: false });
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

  it("keeps the forwarded mark and a contact card (13.11.2026)", async () => {
    const { channel } = await setup();
    await storeMessage(channel, "dana@lid", {
      ...msg("f1", ""),
      forwarded: true,
      attachments: [
        { id: null, type: "contact_card", mimetype: null, voiceNote: false, duration: null, contact: { name: "שלום", phones: ["+972 52-000-0000"] } },
      ],
    });
    const { messages } = await listStoredMessages(channel, "dana@lid");
    expect(messages[0]).toMatchObject({
      forwarded: true,
      attachments: [{ id: null, type: "contact_card", contact: { name: "שלום", phones: ["+972 52-000-0000"] } }],
    });
  });

  it("fills in a card kept before cards were stored", async () => {
    const { channel } = await setup();
    const card = { id: "att1", type: "contact_card", mimetype: null, voiceNote: false, duration: null };
    await storeMessage(channel, "dana@lid", { ...msg("c1", ""), attachments: [card] });
    await enrichStoredMessage(channel.id, "dana@lid", {
      ...msg("c1", ""),
      forwarded: true,
      attachments: [{ ...card, contact: { name: "שלום", phones: ["+972520000000"] } }],
    });
    const { messages } = await listStoredMessages(channel, "dana@lid");
    expect(messages[0].forwarded).toBe(true);
    expect(messages[0].attachments[0]).toMatchObject({ id: "att1", contact: { name: "שלום", phones: ["+972520000000"] } });
  });

  it("keeps a call as a line, applies a reaction to its message, and marks a real edit only (13.11.2026)", async () => {
    const { channel } = await setup();
    await storeMessage(channel, "dana@lid", msg("m1", "נפגש מחר?"));
    await storeMessage(channel, "dana@lid", { ...msg("call1", ""), event: { type: 9, data: { is_video: false } } });
    const reaction = (removed: boolean) => ({ ...msg("r1", ""), reactionTo: { messageId: "m1", reaction: "👍", removed } });
    expect(await storeMessage(channel, "dana@lid", reaction(false))).toBe("skipped");
    expect(await storeMessage(channel, "dana@lid", { ...reaction(false), id: "r2" })).toBe("skipped");

    let { messages } = await listStoredMessages(channel, "dana@lid");
    expect(messages.map((m) => m.id)).toEqual(["m1", "call1"]);
    expect(messages[0].reactions).toEqual([{ reaction: "👍", count: 2 }]);
    expect(messages[1].event).toEqual({ type: 9, data: { is_video: false } });

    await storeMessage(channel, "dana@lid", { ...reaction(true), id: "r3" });
    await storeMessage(channel, "dana@lid", { ...reaction(true), id: "r4" });
    ({ messages } = await listStoredMessages(channel, "dana@lid"));
    expect(messages[0].reactions).toBeUndefined();

    await updateStoredMessage(channel, "dana@lid", msg("m1", "נפגש מחר?"));
    expect((await listStoredMessages(channel, "dana@lid")).messages[0].isEdited).toBeUndefined();
    await updateStoredMessage(channel, "dana@lid", msg("m1", "נפגש מחרתיים?"));
    expect((await listStoredMessages(channel, "dana@lid")).messages[0].isEdited).toBe(true);
  });

  it("does not list a chat that has only group changes", async () => {
    const { channel, anna } = await setup();
    await storeMessage(channel, "g@g.us", { ...msg("e1", ""), event: { type: 3, data: {} } });
    const { listStoredChats } = await import("@/lib/comms/stored-chats");
    expect(await listStoredChats(channel, { id: anna.id, email: anna.email })).toEqual([]);
  });
});
