import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { gatherCommsExport } from "@/lib/comms/export";

// The export of an ended client (2.11.2026): what the engagement-end sweep
// would remove, less what the requester may not see.

describe("gatherCommsExport", () => {
  it("collects the client's people and groups, without held or deleted messages or an excluded number", async () => {
    const { user: hadas } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: owner } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient({ name: "הסתיים" });
    await prisma.client.update({ where: { id: client.id }, data: { status: "ARCHIVED", deletedAt: new Date("2026-11-01T00:00:00Z") } });
    const person = await prisma.person.create({ data: { name: "דנה", phones: ["+972542222222"] } });
    await prisma.clientContact.create({ data: { clientId: client.id, personId: person.id, role: "x" } });

    const open = await prisma.commsChannel.create({ data: { accountId: "acc_open", ownerUserId: owner.id, storeEnabled: true } });
    const closed = await prisma.commsChannel.create({
      data: { accountId: "acc_closed", ownerUserId: owner.id, storeEnabled: true, excludedViewerIds: [hadas.id] },
    });
    const chat = await prisma.commsConversation.create({ data: { channelId: open.id, externalChatId: "dana", otherPhone: "+972542222222", name: "דנה" } });
    await prisma.commsMessage.createMany({
      data: [
        { conversationId: chat.id, externalId: "m1", at: new Date("2026-10-01T08:00:00Z"), text: "נשאר" },
        { conversationId: chat.id, externalId: "m2", at: new Date("2026-10-01T08:01:00Z"), text: "ממתין", held: true },
        { conversationId: chat.id, externalId: "m3", at: new Date("2026-10-01T08:02:00Z"), text: "נמחק", isDeleted: true },
      ],
    });
    await prisma.commsConversation.create({ data: { channelId: open.id, externalChatId: "grp", isGroup: true, name: "קבוצת לקוח", groupClientId: client.id } });
    await prisma.commsConversation.create({ data: { channelId: closed.id, externalChatId: "dana2", otherPhone: "+972542222222", name: "דנה" } });
    await prisma.commsConversation.create({ data: { channelId: open.id, externalChatId: "other", otherPhone: "+972549999999", name: "אחר" } });
    await prisma.callRecording.create({
      data: {
        emailId: "e1",
        mailAccountId: "acc_m",
        fromPhone: "+972542222222",
        toPhone: "+972553302266",
        otherPhone: "+972542222222",
        direction: "IN",
        callAt: new Date("2026-10-02T09:00:00Z"),
        transcript: { create: { status: "DONE", text: "שלום" } },
      },
    });

    const data = await gatherCommsExport(hadas, client.id);
    expect(data).not.toBeNull();
    expect(data!.conversations.map((c) => c.name).sort()).toEqual(["דנה", "קבוצת לקוח"]);
    const dana = data!.conversations.find((c) => c.name === "דנה")!;
    // Deleted in WhatsApp: kept and exported with a mark (13.11.2026).
    expect(dana.messages.map((m) => m.text)).toEqual(["נשאר", "[נמחקה בוואטסאפ] נמחק"]);
    expect(data!.calls).toHaveLength(1);
    expect(data!.calls[0].transcript).toBe("שלום");
    expect(data!.deletesOn?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(await gatherCommsExport(hadas, "missing")).toBeNull();
  });
});
