import "server-only";
import type { CommsChannel, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chatPhone } from "@/lib/whatsapp-poc/inbox";
import {
  UnipileError,
  findChatByPhone,
  getChat,
  isHiddenChat,
  listMessages,
  loadMergedChats,
  readPocConfig,
  type PocChat,
  type PocMessage,
} from "@/lib/whatsapp-poc/unipile";
import type { CommsAccess } from "./access";
import { listStoredChats, listStoredMessages, withLiveChats, type StoredTranscript } from "./stored-chats";

// The communications screen with several WhatsApp numbers (1.11.2026). Each
// connected number (CommsChannel) is read on its own, filtered by who may
// see it, and the lists are put together. A number not stored yet (no
// channel, or "התחל לשמור" not pressed) is read live, by its owner and the
// full viewers only, as the single-number screen did.

export type ChannelInfo = { id: string | null; accountId: string; ownerUserId: string | null; label: string };
/// `numberKey`: the channel id, or "-" for the configured number before it
/// was connected. The audio and file routes take it as ?n= and check it.
export type PageMessage = PocMessage & { chatId: string; channelLabel: string; numberKey: string };

type Unipile = { apiKey: string; accountId: string };

export type WhatsappSources = {
  chats: PocChat[];
  /// Which number each chat belongs to, by chat id.
  channelOf: Map<string, ChannelInfo>;
  /// Chats whose messages are stored (read from here, not Unipile).
  stored: Set<string>;
  channels: Array<CommsChannel & { owner: { name: string | null } }>;
  error: string | null;
};

function unipile(accountId: string): Unipile | null {
  const apiKey = process.env.UNIPILE_API_KEY?.trim();
  return apiKey ? { apiKey, accountId } : null;
}

function mayReadLive(channel: Pick<CommsChannel, "ownerUserId" | "excludedViewerIds">, user: Pick<User, "id">, access: CommsAccess) {
  if (channel.excludedViewerIds.includes(user.id)) return false;
  return channel.ownerUserId === user.id || access.full;
}

export async function loadWhatsapp(user: Pick<User, "id" | "email">, access: CommsAccess): Promise<WhatsappSources> {
  const channels = await prisma.commsChannel.findMany({ include: { owner: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  const out: WhatsappSources = { chats: [], channelOf: new Map(), stored: new Set(), channels, error: null };
  const multi = channels.length > 1;

  for (const ch of channels) {
    const info: ChannelInfo = { id: ch.id, accountId: ch.accountId, ownerUserId: ch.ownerUserId, label: multi ? (ch.owner.name ?? "") : "" };
    let list: PocChat[] = [];
    if (ch.storeEnabled) {
      list = await listStoredChats(ch, user);
      for (const c of list) out.stored.add(c.id);
    }
    const live = unipile(ch.accountId);
    if (live && mayReadLive(ch, user, access)) {
      try {
        const fromUnipile = (await loadMergedChats(live)).chats;
        list = ch.storeEnabled ? await withLiveChats(ch, user, list, fromUnipile) : fromUnipile;
      } catch (err) {
        if (!(err instanceof UnipileError)) throw err;
        out.error = err.message;
      }
    }
    for (const c of list) {
      out.channelOf.set(c.id, info);
      out.chats.push(c);
    }
  }

  // The configured account before it was connected as a channel: as before,
  // for the full viewers only.
  const config = readPocConfig();
  if (config.accountId && !channels.some((c) => c.accountId === config.accountId) && access.full) {
    const live = unipile(config.accountId);
    if (live) {
      try {
        const info: ChannelInfo = { id: null, accountId: config.accountId, ownerUserId: null, label: "" };
        for (const c of (await loadMergedChats(live)).chats) {
          out.channelOf.set(c.id, info);
          out.chats.push(c);
        }
      } catch (err) {
        if (!(err instanceof UnipileError)) throw err;
        out.error = err.message;
      }
    }
  }

  const time = (c: PocChat) => (c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0);
  out.chats.sort((a, b) => time(b) - time(a));
  return out;
}

/// The accounts a person may look a number up in (the "open by number" box):
/// numbers they own, or all of them for the full viewers.
export function lookupAccounts(sources: WhatsappSources, user: Pick<User, "id">, access: CommsAccess): ChannelInfo[] {
  const seen = new Map<string, ChannelInfo>();
  for (const info of sources.channelOf.values()) seen.set(info.accountId, info);
  for (const ch of sources.channels) {
    if (!seen.has(ch.accountId)) seen.set(ch.accountId, { id: ch.id, accountId: ch.accountId, ownerUserId: ch.ownerUserId, label: "" });
  }
  return [...seen.values()].filter((i) => {
    const ch = sources.channels.find((c) => c.accountId === i.accountId);
    return ch ? mayReadLive(ch, user, access) : access.full;
  });
}

/// A chat found by number or id in one of those accounts, when it is not in
/// the lists (an older chat). Each lookup costs Unipile requests.
export async function findChat(
  accounts: ChannelInfo[],
  target: { phone: string } | { chatId: string },
): Promise<{ chat: PocChat; info: ChannelInfo } | null> {
  for (const info of accounts) {
    const live = unipile(info.accountId);
    if (!live) continue;
    const chat = "phone" in target ? await findChatByPhone(live, target.phone) : await getChat(live, target.chatId).catch((err) => {
      if (err instanceof UnipileError && err.status === 404) return null;
      throw err;
    });
    if (chat && !isHiddenChat(chat)) return { chat, info };
  }
  return null;
}

/// The messages of the open contact: one chat, or, for a number, every chat
/// with that number across the numbers the person sees, put together.
export async function loadMessages(
  sources: WhatsappSources,
  chats: PocChat[],
  extra: { chat: PocChat; info: ChannelInfo } | null,
): Promise<{ messages: PageMessage[]; transcripts: Map<string, StoredTranscript>; error: string | null }> {
  const messages: PageMessage[] = [];
  const transcripts = new Map<string, StoredTranscript>();
  let error: string | null = null;
  const targets: Array<{ chat: PocChat; info: ChannelInfo }> = chats
    .map((chat) => ({ chat, info: sources.channelOf.get(chat.id)! }))
    .filter((t) => t.info);
  if (extra && !targets.some((t) => t.chat.id === extra.chat.id)) targets.push(extra);

  for (const { chat, info } of targets) {
    const channel = info.id ? sources.channels.find((c) => c.id === info.id) : null;
    if (channel && sources.stored.has(chat.id)) {
      const got = await listStoredMessages(channel, chat.id);
      for (const m of got.messages) messages.push({ ...m, chatId: chat.id, channelLabel: info.label, numberKey: info.id ?? "-" });
      for (const [k, v] of got.transcripts) transcripts.set(k, v);
      continue;
    }
    const live = unipile(info.accountId);
    if (!live) continue;
    try {
      for (const m of await listMessages(live, chat.id)) messages.push({ ...m, chatId: chat.id, channelLabel: info.label, numberKey: info.id ?? "-" });
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      error = err.message;
    }
  }
  messages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return { messages, transcripts, error };
}

export function chatsWithPhone(sources: WhatsappSources, phone: string): PocChat[] {
  return sources.chats.filter((c) => chatPhone(c) === phone);
}
