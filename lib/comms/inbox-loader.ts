import "server-only";
import type { CommsChannel, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chatPhone } from "@/lib/whatsapp-poc/inbox";
import {
  UnipileError,
  findChatByPhone,
  getChat,
  getMessage,
  isContactAttachment,
  parseVcard,
  isHiddenChat,
  listMessages,
  loadMergedChats,
  readPocConfig,
  type PocChat,
  type PocMessage,
} from "@/lib/whatsapp-poc/unipile";
import type { CommsAccess } from "./access";
import { isExcludedViewer } from "./visibility";
import { enrichStoredMessage } from "./whatsapp-store";
import { fetchMessageAttachment, isSafeChatId, isSafeMessageId } from "@/lib/whatsapp-poc/voice-notes";
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

/// A chat as one of our numbers has it (12.11.2026). WhatsApp's chat id is
/// the other person's id, the same on every number that talks to them, so
/// Ariel's chat with Hadas and Anna's chat with Hadas share it. Until then
/// the chat's number was looked up by its id alone, and the number read last
/// won: Ariel's chat showed under Anna's name and with Anna's messages.
export type WaChat = PocChat & { numberKey: string };

export function numberKeyOf(info: Pick<ChannelInfo, "id">): string {
  return info.id ?? "-";
}

/// One conversation's key: its number and its chat id.
export function conversationKey(numberKey: string, chatId: string): string {
  return `${numberKey} ${chatId}`;
}

type Unipile = { apiKey: string; accountId: string };

export type WhatsappSources = {
  chats: WaChat[];
  /// The numbers the chats came from, by numberKey.
  numbers: Map<string, ChannelInfo>;
  /// Conversations whose messages are stored (read from here, not
  /// Unipile), by conversationKey.
  stored: Set<string>;
  channels: Array<CommsChannel & { owner: { name: string | null } }>;
  /// The error itself, not its sentence: the screen words it (ADR 0006).
  error: UnipileError | null;
};

function unipile(accountId: string): Unipile | null {
  const apiKey = process.env.UNIPILE_API_KEY?.trim();
  return apiKey ? { apiKey, accountId } : null;
}

function mayReadLive(channel: Pick<CommsChannel, "ownerUserId" | "excludedViewerIds" | "excludeAllViewers">, user: Pick<User, "id">, access: CommsAccess) {
  if (isExcludedViewer(channel, user.id)) return false;
  return channel.ownerUserId === user.id || access.full;
}

export async function loadWhatsapp(user: Pick<User, "id" | "email">, access: CommsAccess): Promise<WhatsappSources> {
  const channels = await prisma.commsChannel.findMany({ include: { owner: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  const out: WhatsappSources = { chats: [], numbers: new Map(), stored: new Set(), channels, error: null };
  const multi = channels.length > 1;

  // 5.11.2026 (Ariel: opening a conversation took 2 to 4 seconds): the
  // numbers are read side by side, not one after the other. Each still
  // reads its stored list and, where allowed, Unipile's live list; the
  // results are put together in the numbers' order, as before.
  const perChannel = await Promise.all(
    channels.map(async (ch) => {
      const info: ChannelInfo = { id: ch.id, accountId: ch.accountId, ownerUserId: ch.ownerUserId, label: multi ? (ch.owner.name ?? "") : "" };
      let list: PocChat[] = [];
      let error: UnipileError | null = null;
      const stored = new Set<string>();
      if (ch.storeEnabled) {
        list = await listStoredChats(ch, user);
        for (const c of list) stored.add(c.id);
      }
      const live = unipile(ch.accountId);
      if (live && mayReadLive(ch, user, access)) {
        try {
          const fromUnipile = (await loadMergedChats(live)).chats;
          list = ch.storeEnabled ? await withLiveChats(ch, user, list, fromUnipile) : fromUnipile;
        } catch (err) {
          if (!(err instanceof UnipileError)) throw err;
          error = err;
        }
      }
      return { info, list, stored, error };
    }),
  );
  for (const { info, list, stored, error } of perChannel) {
    const key = numberKeyOf(info);
    for (const id of stored) out.stored.add(conversationKey(key, id));
    if (error) out.error = error;
    if (list.length > 0) out.numbers.set(key, info);
    for (const c of list) out.chats.push({ ...c, numberKey: key });
  }

  // The configured account before it was connected as a channel: as before,
  // for the full viewers only.
  const config = readPocConfig();
  if (config.accountId && !channels.some((c) => c.accountId === config.accountId) && access.full) {
    const live = unipile(config.accountId);
    if (live) {
      try {
        const info: ChannelInfo = { id: null, accountId: config.accountId, ownerUserId: null, label: "" };
        const chats = (await loadMergedChats(live)).chats;
        if (chats.length > 0) out.numbers.set(numberKeyOf(info), info);
        for (const c of chats) out.chats.push({ ...c, numberKey: numberKeyOf(info) });
      } catch (err) {
        if (!(err instanceof UnipileError)) throw err;
        out.error = err;
      }
    }
  }

  const time = (c: WaChat) => (c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0);
  out.chats.sort((a, b) => time(b) - time(a));
  return out;
}

/// The accounts a person may look a number up in (the "open by number" box):
/// numbers they own, or all of them for the full viewers.
export function lookupAccounts(sources: WhatsappSources, user: Pick<User, "id">, access: CommsAccess): ChannelInfo[] {
  const seen = new Map<string, ChannelInfo>();
  for (const info of sources.numbers.values()) seen.set(info.accountId, info);
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

/// The number a chat in the lists was read from.
export function infoOf(sources: Pick<WhatsappSources, "numbers">, chat: Pick<WaChat, "numberKey">): ChannelInfo | null {
  return sources.numbers.get(chat.numberKey) ?? null;
}

export function isStored(sources: Pick<WhatsappSources, "stored">, chat: Pick<WaChat, "id" | "numberKey">): boolean {
  return sources.stored.has(conversationKey(chat.numberKey, chat.id));
}

/// The open contact's chats, the person's own number first: the reply, the
/// block button and the rail act on the first (12.11.2026).
export function ownFirst(sources: Pick<WhatsappSources, "numbers">, chats: WaChat[], userId: string): WaChat[] {
  const own = (c: WaChat) => (infoOf(sources, c)?.ownerUserId === userId ? 0 : 1);
  return [...chats].sort((a, b) => own(a) - own(b));
}

/// The messages of the open contact: one chat, or, for a number, every chat
/// with that number across the numbers the person sees, put together.
export async function loadMessages(
  sources: WhatsappSources,
  chats: WaChat[],
  extra: { chat: PocChat; info: ChannelInfo } | null,
  before: Date | null = null,
): Promise<{ messages: PageMessage[]; transcripts: Map<string, StoredTranscript>; error: UnipileError | null; hasOlder: boolean }> {
  let hasOlder = false;
  const messages: PageMessage[] = [];
  const transcripts = new Map<string, StoredTranscript>();
  let error: UnipileError | null = null;
  const targets: Array<{ chat: PocChat; info: ChannelInfo; stored: boolean }> = chats
    .map((chat) => ({ chat, info: infoOf(sources, chat)!, stored: isStored(sources, chat) }))
    .filter((t) => t.info);
  if (extra && !targets.some((t) => t.chat.id === extra.chat.id && t.info.accountId === extra.info.accountId)) {
    targets.push({ ...extra, stored: false });
  }
  // A group with two of our numbers in it is one chat id on both, with the
  // same messages: each is shown once, from the first number.
  const seen = new Set<string>();
  const add = (m: PocMessage, chatId: string, info: ChannelInfo) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    messages.push({ ...m, chatId, channelLabel: info.label, numberKey: numberKeyOf(info) });
  };

  for (const { chat, info, stored } of targets) {
    const channel = info.id ? sources.channels.find((c) => c.id === info.id) : null;
    if (channel && stored) {
      const got = await listStoredMessages(channel, chat.id, 200, before);
      if (got.hasOlder) hasOlder = true;
      for (const m of got.messages) add(m, chat.id, info);
      for (const [k, v] of got.transcripts) transcripts.set(k, v);
      continue;
    }
    const live = unipile(info.accountId);
    if (!live) continue;
    try {
      for (const m of await listMessages(live, chat.id)) add(m, chat.id, info);
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      error = err;
    }
  }
  messages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  await fillContactCards(sources, messages);
  return { messages, transcripts, error, hasOlder };
}

/// Contact cards read per page load, at most. Each costs one to three
/// Unipile requests, and the account has a daily quota (PR #375).
const MAX_CARDS_FILLED = 3;

/// 13.11.2026 (Ariel: a contact sent in WhatsApp showed as "הורדת קובץ"):
/// a contact card without its name and numbers is read again from Unipile,
/// and, if it is still only a vCard file, the file is read and parsed. A
/// stored message keeps what was found, so this happens once per card.
async function fillContactCards(sources: WhatsappSources, messages: PageMessage[]) {
  let budget = MAX_CARDS_FILLED;
  for (const m of messages) {
    if (budget <= 0) return;
    if (m.isDeleted || !m.attachments.some((a) => a.id && !a.contact && isContactAttachment(a))) continue;
    if (!isSafeChatId(m.chatId) || !isSafeMessageId(m.id)) continue;
    const info = sources.numbers.get(m.numberKey);
    const live = info ? unipile(info.accountId) : null;
    if (!info || !live) continue;
    budget -= 1;
    try {
      const fresh = await getMessage(live, m.chatId, m.id);
      if (!fresh) continue;
      for (const a of fresh.attachments) {
        if (a.contact || !a.id || !isContactAttachment(a)) continue;
        const file = await fetchMessageAttachment(live, m.chatId, m.id, a.id);
        const card = file ? parseVcard(new TextDecoder().decode(file.bytes)) : null;
        if (card) a.contact = card;
      }
      m.attachments = fresh.attachments;
      if (fresh.quoted && !m.quoted) m.quoted = fresh.quoted;
      if (fresh.forwarded) m.forwarded = true;
      if (info.id && isStored(sources, { id: m.chatId, numberKey: m.numberKey })) await enrichStoredMessage(info.id, m.chatId, fresh);
    } catch (err) {
      // The card stays a download; the screen is not failed for it.
      if (!(err instanceof UnipileError)) throw err;
      return;
    }
  }
}

export function chatsWithPhone(sources: WhatsappSources, phone: string): WaChat[] {
  return sources.chats.filter((c) => chatPhone(c) === phone);
}
