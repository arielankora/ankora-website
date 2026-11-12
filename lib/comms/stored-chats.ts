import "server-only";
import type { CommsChannel, TranscriptStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { matchPhones } from "@/lib/whatsapp-poc/clients-by-phone";
import type { PocChat, PocMessage } from "@/lib/whatsapp-poc/unipile";
import { blockStateFor, canSeeConversation, isExcludedViewer } from "./visibility";
import { fullViewerEmails } from "./grants";
import { chatPhone } from "@/lib/whatsapp-poc/inbox";

// Stage 3: the communications screen reads a stored number's WhatsApp
// conversations from here, in the shapes it already draws (PocChat,
// PocMessage). Each conversation is shown only to whom the spec's rules
// allow (lib/comms/visibility.ts), and a message held by a block request
// is shown to nobody.

export async function storedChannelFor(accountId: string | null): Promise<CommsChannel | null> {
  if (!accountId) return null;
  return prisma.commsChannel.findUnique({ where: { accountId } });
}

export async function listStoredChats(channel: CommsChannel, viewer: { id: string; email: string }, take = 300): Promise<PocChat[]> {
  const conversations = await prisma.commsConversation.findMany({
    where: { channelId: channel.id, messages: { some: { held: false } } },
    orderBy: { lastMessageAt: "desc" },
    take,
    include: {
      messages: { where: { held: false }, orderBy: { at: "desc" }, take: 1, select: { text: true, attachments: { select: { type: true } } } },
    },
  });
  const groupClientNames = new Map(
    (
      await prisma.client.findMany({
        where: { id: { in: conversations.map((c) => c.groupClientId).filter((id): id is string => Boolean(id)) } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name]),
  );

  // Which clients each conversation belongs to, and their account managers.
  const owners = await matchPhones(conversations.map((c) => c.otherPhone).filter((p): p is string => Boolean(p)));
  const clientIds = new Set<string>();
  for (const c of conversations) {
    if (c.groupClientId) clientIds.add(c.groupClientId);
    if (c.otherPhone) for (const cl of owners.get(c.otherPhone)?.clients ?? []) clientIds.add(cl.id);
  }
  const managers = new Map(
    (await prisma.client.findMany({ where: { id: { in: [...clientIds] } }, select: { id: true, accountManagerId: true } })).map((c) => [
      c.id,
      c.accountManagerId,
    ]),
  );
  const fullViewers = await fullViewerEmails();

  return conversations
    .filter((c) => {
      const ids = [...(c.otherPhone ? (owners.get(c.otherPhone)?.clients ?? []).map((x) => x.id) : []), ...(c.groupClientId ? [c.groupClientId] : [])];
      return canSeeConversation({
        viewer,
        channel,
        clients: ids.map((id) => ({ id, accountManagerId: managers.get(id) ?? null })),
        fullViewers,
      });
    })
    .map((c) => {
      const last = c.messages[0];
      const preview = last ? last.text || (last.attachments[0]?.type === "audio" ? "הודעה קולית" : last.attachments.length ? "קובץ" : "") : "";
      return {
        id: c.externalChatId,
        name: c.name,
        type: c.isGroup ? "group" : "1to1",
        phone: c.otherPhone,
        unreadCount: 0,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: preview,
        groupClient: c.groupClientId ? { id: c.groupClientId, name: groupClientNames.get(c.groupClientId) ?? "" } : null,
      };
    });
}

export type StoredTranscript = { status: TranscriptStatus; text: string | null };

/// The latest messages of one stored conversation, oldest first, with each
/// voice message's transcript by message id.
export async function listStoredMessages(
  channel: CommsChannel,
  chatId: string,
  take = 200,
  /// Older messages (1.11.2026): those before this instant.
  before: Date | null = null,
): Promise<{ messages: PocMessage[]; transcripts: Map<string, StoredTranscript>; hasOlder: boolean }> {
  const conversation = await prisma.commsConversation.findUnique({
    where: { channelId_externalChatId: { channelId: channel.id, externalChatId: chatId } },
  });
  if (!conversation) return { messages: [], transcripts: new Map(), hasOlder: false };
  const fetched = await prisma.commsMessage.findMany({
    where: { conversationId: conversation.id, held: false, ...(before ? { at: { lt: before } } : {}) },
    orderBy: { at: "desc" },
    take: take + 1,
    include: { attachments: { include: { transcript: { select: { status: true, text: true } } } } },
  });
  const hasOlder = fetched.length > take;
  const rows = fetched.slice(0, take);
  const transcripts = new Map<string, StoredTranscript>();
  const messages: PocMessage[] = rows.reverse().map((r) => {
    for (const a of r.attachments) if (a.transcript) transcripts.set(r.externalId, a.transcript);
    return {
      id: r.externalId,
      text: r.text,
      timestamp: r.at.toISOString(),
      isSender: r.isSender,
      senderName: r.senderName,
      isDeleted: r.isDeleted,
      attachments: r.attachments.map((a) => ({
        id: a.externalId,
        type: a.type,
        mimetype: a.mimetype,
        voiceNote: a.voiceNote,
        duration: a.durationSec,
      })),
    };
  });
  return { messages, transcripts, hasOlder };
}

/// Until a number's history has been loaded, its stored list is short or
/// empty (1.11.2026: the WhatsApp filter was empty right after "התחל
/// לשמור"). So the live list from Unipile fills in the chats not stored
/// yet, without anything on the block list (approved or pending), and only
/// for the number's owner and the full viewers, who may see any of its
/// conversations. Stored chats win; the result is newest first.
export async function withLiveChats(
  channel: CommsChannel,
  viewer: { id: string; email: string },
  stored: PocChat[],
  live: PocChat[],
): Promise<PocChat[]> {
  const fullViewers = await fullViewerEmails();
  const email = viewer.email.trim().toLowerCase();
  if (isExcludedViewer(channel, viewer.id)) return stored;
  if (channel.ownerUserId !== viewer.id && !fullViewers.includes(email)) return stored;
  // The stored list has no read state; WhatsApp's own (5.11.2026, "סמן
  // כנקראה") comes from the live list.
  const unread = new Map(live.map((c) => [c.id, c.unreadCount]));
  stored = stored.map((c) => ({ ...c, unreadCount: unread.get(c.id) ?? c.unreadCount }));
  const blocks = await prisma.commsBlock.findMany({ where: { channelId: channel.id }, select: { kind: true, value: true, status: true } });
  const have = new Set(stored.map((c) => c.id));
  const extra = live.filter((c) => !have.has(c.id) && blockStateFor(blocks, { phone: phoneOf(c), chatId: c.id }) === "none");
  const time = (c: PocChat) => (c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0);
  return [...stored, ...extra].sort((a, b) => time(b) - time(a));
}

function phoneOf(c: PocChat): string | null {
  return chatPhone(c);
}

export type MessageHit = { chatId: string; channelId: string; messageId: string; at: string; text: string; isSender: boolean; name: string };

/// "חיפוש בתוך ההודעות" (5.11.2026, Ariel): the text of stored messages,
/// newest first. Only in the conversations the caller already found this
/// person may see (`visible`, chat ids from listStoredChats), and never a
/// message held by a block request or deleted. Conversations read live
/// from Unipile cannot be searched: Unipile has no text search for them.
export async function searchStoredMessages(
  channelIds: string[],
  visible: Set<string>,
  query: string,
  take = 40,
): Promise<MessageHit[]> {
  const q = query.trim();
  if (q.length < 2 || channelIds.length === 0 || visible.size === 0) return [];
  const rows = await prisma.commsMessage.findMany({
    where: {
      held: false,
      isDeleted: false,
      text: { contains: q, mode: "insensitive" },
      conversation: { channelId: { in: channelIds }, externalChatId: { in: [...visible] } },
    },
    orderBy: { at: "desc" },
    take,
    select: {
      externalId: true,
      at: true,
      text: true,
      isSender: true,
      conversation: { select: { externalChatId: true, channelId: true, name: true } },
    },
  });
  return rows.map((r) => ({
    chatId: r.conversation.externalChatId,
    channelId: r.conversation.channelId,
    messageId: r.externalId,
    at: r.at.toISOString(),
    text: r.text,
    isSender: r.isSender,
    name: r.conversation.name,
  }));
}

