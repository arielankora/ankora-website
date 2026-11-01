import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { matchPhones } from "@/lib/whatsapp-poc/clients-by-phone";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { commsAccess } from "./access";
import { canSeeConversation, parseViewerEmails } from "./visibility";

// The audio and file routes (1.11.2026, several numbers): which Unipile
// account a chat's file is read from, and whether this person may have it.
// The page passes the number (`n`, a channel id, or "-" for the configured
// number before it was connected); the answer is checked here, never
// trusted.

export async function accountForChatFile(
  user: Pick<User, "id" | "email" | "role">,
  numberParam: string | null,
  chatId: string,
): Promise<{ apiKey: string; accountId: string } | null> {
  const apiKey = process.env.UNIPILE_API_KEY?.trim();
  if (!apiKey) return null;
  const access = await commsAccess(user);
  if (!access.allowed) return null;

  if (!numberParam || numberParam === "-") {
    const config = readPocConfig();
    if (!access.full || !config.accountId) return null;
    const connected = await prisma.commsChannel.findUnique({ where: { accountId: config.accountId }, select: { id: true } });
    return connected ? null : { apiKey, accountId: config.accountId };
  }

  const channel = await prisma.commsChannel.findUnique({ where: { id: numberParam } });
  if (!channel || channel.excludedViewerIds.includes(user.id)) return null;
  if (channel.ownerUserId === user.id || access.full) return { apiKey, accountId: channel.accountId };

  // Anyone else: only a stored conversation of a client they manage.
  const conversation = await prisma.commsConversation.findUnique({
    where: { channelId_externalChatId: { channelId: channel.id, externalChatId: chatId } },
  });
  if (!conversation) return null;
  const clientIds = [
    ...(conversation.otherPhone ? ((await matchPhones([conversation.otherPhone])).get(conversation.otherPhone)?.clients ?? []).map((c) => c.id) : []),
    ...(conversation.groupClientId ? [conversation.groupClientId] : []),
  ];
  const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, accountManagerId: true } });
  const ok = canSeeConversation({ viewer: user, channel, clients, fullViewers: parseViewerEmails(process.env.COMMS_FULL_VIEWERS) });
  return ok ? { apiKey, accountId: channel.accountId } : null;
}
