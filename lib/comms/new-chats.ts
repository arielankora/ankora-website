import "server-only";
import type { CommsChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { matchPhones } from "@/lib/whatsapp-poc/clients-by-phone";
import { blockStateFor } from "./visibility";

// "שיחות חדשות לבדיקה" (Ariel, 5.11.2026). The "לא לשמור" list is chosen once,
// before "התחל לשמור", from the chats that existed then. A chat that began
// later was stored with no one asked about it. These are those chats: they
// began after storing started (no message from before), nobody decided on
// them yet, and they are not on the block list. Until someone decides they
// are stored, as before; "לשמור" marks them reviewed, "לא לשמור" is the
// ordinary block (lib/comms/whatsapp-store.ts requestBlock).

export type ChatToReview = {
  conversationId: string;
  name: string;
  isGroup: boolean;
  phone: string | null;
  messages: number;
  firstAt: string | null;
  clients: string[];
};

function toReviewWhere(channel: Pick<CommsChannel, "id" | "storeStartedAt">): Prisma.CommsConversationWhereInput | null {
  if (!channel.storeStartedAt) return null;
  return {
    channelId: channel.id,
    reviewedAt: null,
    // Began after storing started: nothing older was stored. A chat from
    // before carries its older messages once its history is loaded.
    messages: { some: { held: false }, none: { at: { lt: channel.storeStartedAt } } },
  };
}

async function blocks(channelId: string) {
  return prisma.commsBlock.findMany({ where: { channelId }, select: { kind: true, value: true, status: true } });
}

/// The chats of one number still to decide on, newest first.
export async function listChatsToReview(channel: Pick<CommsChannel, "id" | "storeStartedAt">, take = 20): Promise<{ chats: ChatToReview[]; total: number }> {
  const where = toReviewWhere(channel);
  if (!where) return { chats: [], total: 0 };
  const [rows, list] = await Promise.all([
    prisma.commsConversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: take * 2,
      include: {
        _count: { select: { messages: { where: { held: false } } } },
        messages: { where: { held: false }, orderBy: { at: "asc" }, take: 1, select: { at: true } },
      },
    }),
    blocks(channel.id),
  ]);
  const open = rows.filter((c) => blockStateFor(list, { phone: c.otherPhone, chatId: c.externalChatId }) === "none");
  const total = await countChatsToReview(channel);
  const shown = open.slice(0, take);
  const owners = await matchPhones(shown.map((c) => c.otherPhone).filter((p): p is string => Boolean(p)));
  return {
    total,
    chats: shown.map((c) => ({
      conversationId: c.id,
      name: c.name,
      isGroup: c.isGroup,
      phone: c.otherPhone,
      messages: c._count.messages,
      firstAt: c.messages[0]?.at.toISOString() ?? null,
      clients: c.otherPhone ? (owners.get(c.otherPhone)?.clients ?? []).map((x) => x.name) : [],
    })),
  };
}

/// How many are waiting, for the label on the communications screen.
export async function countChatsToReview(channel: Pick<CommsChannel, "id" | "storeStartedAt">): Promise<number> {
  const where = toReviewWhere(channel);
  if (!where) return 0;
  const [rows, list] = await Promise.all([
    prisma.commsConversation.findMany({ where, select: { otherPhone: true, externalChatId: true } }),
    blocks(channel.id),
  ]);
  return rows.filter((c) => blockStateFor(list, { phone: c.otherPhone, chatId: c.externalChatId }) === "none").length;
}
