import { describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// 12.11.2026: a WhatsApp chat id is the other person's id, the same on every
// number that talks to them. Ariel's chat with Hadas and Anna's chat with
// Hadas both had "236739352334449@lid", and the search inside the messages
// matched by chat id across all numbers: someone allowed to see Anna's chat
// with Hadas also got the messages of Ariel's chat with her, though nobody
// but Ariel may see his number's conversations.

vi.mock("server-only", () => ({}));

import { searchStoredMessages } from "@/lib/comms/stored-chats";

const SAME = "same-person@lid";

async function conversation(channelId: string, text: string) {
  const c = await prisma.commsConversation.create({
    data: { channelId, externalChatId: SAME, isGroup: false, otherPhone: "+972553302266", name: "ANKORA" },
  });
  await prisma.commsMessage.create({
    data: { conversationId: c.id, externalId: `${channelId}-m1`, at: new Date("2026-11-12T16:00:00Z"), isSender: false, text },
  });
}

describe("two numbers, one chat id", () => {
  it("searches each number's own conversations only", async () => {
    const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const arielNumber = await prisma.commsChannel.create({
      data: { accountId: "acc_ariel", ownerUserId: ariel.id, storeEnabled: true, excludeAllViewers: true },
    });
    const annaNumber = await prisma.commsChannel.create({ data: { accountId: "acc_anna", ownerUserId: anna.id, storeEnabled: true } });
    await conversation(arielNumber.id, "סוד של אריאל");
    await conversation(annaNumber.id, "סוד של אנה");

    // Someone who sees Anna's chat with this person, and not Ariel's.
    const annaOnly = await searchStoredMessages(new Map([[annaNumber.id, [SAME]]]), "סוד");
    expect(annaOnly.map((h) => h.text)).toEqual(["סוד של אנה"]);
    expect(annaOnly[0].channelId).toBe(annaNumber.id);

    // Ariel, who sees both.
    const both = await searchStoredMessages(
      new Map([
        [arielNumber.id, [SAME]],
        [annaNumber.id, [SAME]],
      ]),
      "סוד",
    );
    expect(both.map((h) => h.text).sort()).toEqual(["סוד של אנה", "סוד של אריאל"]);

    expect(await searchStoredMessages(new Map(), "סוד")).toEqual([]);
  });
});
