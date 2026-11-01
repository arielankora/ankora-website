import "server-only";
import { afterResponse } from "@/lib/after-response";
import { parseEmailList, parsePhoneList } from "./access";

// WhatsApp POC (31.10.2026): a thin, read-mostly client for the Unipile v2
// API. Nothing is stored: every screen load reads the chats live, so the
// POC adds no table, no migration and no copy of anyone's messages.
//
// Configuration, all in the deployment's environment:
// - UNIPILE_API_KEY: preferably a scoped Account API key that reaches only
//   the one WhatsApp account below (Unipile v2 "Scopes").
// - UNIPILE_WHATSAPP_ACCOUNT_ID: "acc_...".
// - WHATSAPP_POC_VIEWERS: addresses that may open the screen.
// - WHATSAPP_POC_SEND_TO: the only numbers a message may be sent to.
// Missing values leave the screen in a "not configured" state; they never
// fall back to something wider.

const BASE_URL = "https://api.unipile.com/v2";
const TIMEOUT_MS = 15_000;

export type PocConfig = {
  apiKey: string | null;
  accountId: string | null;
  viewers: string[];
  sendTo: string[];
  /// Stage 2: the aloha@ mailbox as a Unipile account ("acc_...").
  mailAccountId: string | null;
  /// Stage 2: Ankora's own number on the Aloha line, to tell incoming
  /// calls from outgoing ones.
  lineNumber: string | null;
  /// Stage 2: transcription is offered only when this is set.
  hasOpenAiKey: boolean;
};

function accountIdFrom(raw: string | undefined): string | null {
  const value = raw?.trim() || "";
  return /^acc_[A-Za-z0-9]+$/.test(value) ? value : null;
}

export function readPocConfig(): PocConfig {
  const apiKey = process.env.UNIPILE_API_KEY?.trim() || null;
  return {
    apiKey,
    accountId: accountIdFrom(process.env.UNIPILE_WHATSAPP_ACCOUNT_ID),
    viewers: parseEmailList(process.env.WHATSAPP_POC_VIEWERS),
    sendTo: parsePhoneList(process.env.WHATSAPP_POC_SEND_TO),
    mailAccountId: accountIdFrom(process.env.ALOHA_UNIPILE_ACCOUNT_ID),
    lineNumber: parsePhoneList(process.env.ALOHA_LINE_NUMBER)[0] ?? null,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}

export function isConfigured(config: PocConfig): config is PocConfig & { apiKey: string; accountId: string } {
  return Boolean(config.apiKey && config.accountId);
}

export type PocChat = {
  id: string;
  name: string;
  type: "1to1" | "group" | "channel" | string;
  phone: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
};

export type PocAttachment = {
  id: string | null;
  type: string;
  mimetype: string | null;
  voiceNote: boolean;
  /// Seconds, for audio.
  duration: number | null;
};

export type PocMessage = {
  id: string;
  text: string;
  timestamp: string;
  isSender: boolean;
  senderName: string | null;
  attachments: PocAttachment[];
  isDeleted: boolean;
};

/// What to tell a person when Unipile answers 429.
///
/// 1.11.2026: Unipile's 429 is not always a short burst limit. On the chat
/// list it was a quota: "We only allow 100 requests. Retry in 15 hours."
/// Telling someone to try again in a minute was wrong for most of a day,
/// so the wait Unipile states is passed on when there is one.
export function rateLimitMessage(title: unknown): string {
  const t = typeof title === "string" ? title : "";
  const m = /retry in (\d+)\s*(second|minute|hour|day)s?/i.exec(t);
  if (!m) return "Unipile מגביל כרגע את קצב הבקשות. נסו שוב בעוד דקה.";
  const n = Number(m[1]);
  const unit = { second: "שניות", minute: "דקות", hour: "שעות", day: "ימים" }[m[2].toLowerCase() as "second" | "minute" | "hour" | "day"];
  return `המכסה של Unipile לבקשה הזו נוצלה, והיא תתחדש בעוד כ-${n} ${unit}. אפשר עדיין לפתוח שיחה לפי מספר.`;
}

export async function rateLimitError(response: Response): Promise<UnipileError> {
  let title: unknown = null;
  try {
    title = ((await response.json()) as { title?: unknown } | null)?.title;
  } catch {
    // No body, or not JSON: the generic message stands.
  }
  return new UnipileError(rateLimitMessage(title), 429);
}

export class UnipileError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "UnipileError";
  }
}

async function call(
  config: { apiKey: string; accountId: string },
  path: string,
  init?: { method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown },
): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${config.accountId}${path}`);
  for (const [k, v] of Object.entries(init?.query ?? {})) url.searchParams.set(k, v);
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        "X-API-KEY": config.apiKey,
        accept: "application/json",
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new UnipileError("Unipile לא ענה.", null);
  }
  if (!response.ok) {
    // The body can echo identifiers; it is not shown or logged.
    if (response.status === 429) throw await rateLimitError(response);
    throw new UnipileError(`Unipile החזיר שגיאה ${response.status}.`, response.status);
  }
  return response.json();
}

type RawChat = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  unread_count?: unknown;
  last_message_timestamp?: unknown;
  last_message?: { text?: unknown } | null;
  user?: { public_identifier?: unknown; display_name?: unknown } | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function toPocChat(raw: RawChat): PocChat | null {
  const id = str(raw.id);
  if (!id) return null;
  const type = str(raw.type) ?? "1to1";
  return {
    id,
    name: str(raw.name) ?? str(raw.user?.display_name) ?? "ללא שם",
    type,
    phone: type === "1to1" ? str(raw.user?.public_identifier) : null,
    unreadCount: typeof raw.unread_count === "number" ? raw.unread_count : 0,
    lastMessageAt: str(raw.last_message_timestamp),
    lastMessagePreview: str(raw.last_message?.text),
  };
}

type RawMessage = {
  id?: unknown;
  text?: unknown;
  timestamp?: unknown;
  is_sender?: unknown;
  is_deleted?: unknown;
  is_event?: unknown;
  sender?: { display_name?: unknown } | null;
  attachments?: Array<{ id?: unknown; type?: unknown; mimetype?: unknown; voice_note?: unknown; duration?: unknown }> | null;
};

export function toPocMessage(raw: RawMessage): PocMessage | null {
  const id = str(raw.id);
  const timestamp = str(raw.timestamp);
  if (!id || !timestamp || raw.is_event === true) return null;
  return {
    id,
    text: typeof raw.text === "string" ? raw.text : "",
    timestamp,
    isSender: raw.is_sender === true,
    senderName: str(raw.sender?.display_name),
    isDeleted: raw.is_deleted === true,
    attachments: (raw.attachments ?? []).map((a) => ({
      id: str(a.id),
      type: str(a.type) ?? "file",
      mimetype: str(a.mimetype),
      voiceNote: a.voice_note === true,
      duration: typeof a.duration === "number" ? a.duration : null,
    })),
  };
}

function dataArray(body: unknown): unknown[] {
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : [];
}

/// WhatsApp's own "status" feed (status@broadcast) arrives as a chat. It is
/// nobody's conversation, so it is left out of the list.
export function isHiddenChat(chat: PocChat): boolean {
  return chat.id === "status@broadcast" || chat.id.endsWith("@broadcast");
}

export const CHAT_PAGE_SIZE = 30;
// One request per read of the list (1.11.2026). Unipile counts requests
// per route and account against a quota, and four pages of 50 on every
// read used up 100 requests to /chats in one evening of testing. The 100
// most recent chats are enough for the POC; older ones open by number.
const FETCH_PAGE_SIZE = 100;
const MAX_CHATS = 100;
const MAX_OFFSET = Math.floor((MAX_CHATS - 1) / CHAT_PAGE_SIZE) * CHAT_PAGE_SIZE;

/// The page offset from the URL: a whole multiple of the page size, or 0.
export function parseOffset(raw: string | undefined | null): number {
  if (!raw || !/^\d{1,5}$/.test(raw)) return 0;
  const n = Number(raw);
  if (n > MAX_OFFSET || n % CHAT_PAGE_SIZE !== 0) return 0;
  return n;
}

function time(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/// One entry per chat id, newest activity first, without the status feed.
///
/// 31.10.2026: Unipile's WhatsApp chat list is not a stable list. It gave
/// no next_cursor, its offset pages overlapped (5 of 31 chats on page two
/// were already on page one), and one chat came back three times on the
/// same page. So the list is read once, as a whole, and ordered and paged
/// here. Of two copies of a chat, the one with the later activity wins.
export function mergeChats(raw: PocChat[]): PocChat[] {
  const byId = new Map<string, PocChat>();
  for (const chat of raw) {
    if (isHiddenChat(chat)) continue;
    const seen = byId.get(chat.id);
    if (!seen || time(chat.lastMessageAt) > time(seen.lastMessageAt)) byId.set(chat.id, chat);
  }
  return [...byId.values()].sort((a, b) => time(b.lastMessageAt) - time(a.lastMessageAt));
}

async function fetchAllChats(config: { apiKey: string; accountId: string }): Promise<PocChat[]> {
  const all: PocChat[] = [];
  for (let offset = 0; offset < MAX_CHATS; offset += FETCH_PAGE_SIZE) {
    const query: Record<string, string> = { limit: String(FETCH_PAGE_SIZE) };
    if (offset > 0) query.offset = String(offset);
    const raw = dataArray(await call(config, "/chats", { query }));
    for (const c of raw) {
      const chat = toPocChat(c as RawChat);
      if (chat) all.push(chat);
    }
    if (raw.length < FETCH_PAGE_SIZE) break;
  }
  return all;
}

// 1.11.2026: reading the whole list once cost up to four calls (now one), and doing that
// on every page load made the screen take 6 to 12 seconds and, by the
// fourth load in two minutes, drew a 429 from Unipile. So the merged list
// is kept in this server instance's memory:
//   - under ten minutes old, it is used as is;
//   - up to two hours old, it is shown at once and re-read after the
//     response has gone out, so the next load has the new one;
//   - older, or none yet (a fresh instance), the person waits for a read.
// A 429 or any other failure of the background read leaves the old list
// in place; it is logged, and the person never sees it.
//
// The memory is per instance and is never written anywhere. It holds what
// the screen already shows: chat names and the last message preview.
// Ten minutes fresh and two hours as a fallback (1.11.2026, after the
// quota above): a list read stays in use far longer, so a morning of use
// costs a handful of requests rather than one per minute.
export const CHAT_LIST_FRESH_MS = 10 * 60_000;
export const CHAT_LIST_MAX_AGE_MS = 2 * 60 * 60_000;

type Config = { apiKey: string; accountId: string };
type CachedList = { accountId: string; at: number; chats: PocChat[] };
let cachedList: CachedList | null = null;
let refreshing: Promise<void> | null = null;

/// For tests: forget the remembered list.
export function resetChatListCache(): void {
  cachedList = null;
  refreshing = null;
}

type Schedule = (work: () => Promise<void>) => void | Promise<void>;
const scheduleAfterResponse: Schedule = (work) => afterResponse("whatsapp-poc chat list refresh", work);

async function readAndRemember(config: Config, fetchAll: (config: Config) => Promise<PocChat[]>, now: () => number) {
  const chats = mergeChats(await fetchAll(config));
  cachedList = { accountId: config.accountId, at: now(), chats };
  return chats;
}

export async function loadMergedChats(
  config: Config,
  fetchAll: (config: Config) => Promise<PocChat[]> = fetchAllChats,
  now: () => number = Date.now,
  schedule: Schedule = scheduleAfterResponse,
): Promise<{ chats: PocChat[]; refreshing: boolean }> {
  const cached = cachedList && cachedList.accountId === config.accountId ? cachedList : null;
  const age = cached ? now() - cached.at : Infinity;

  if (cached && age < CHAT_LIST_FRESH_MS) return { chats: cached.chats, refreshing: false };

  if (cached && age < CHAT_LIST_MAX_AGE_MS) {
    if (!refreshing) {
      const run = async () => {
        try {
          await readAndRemember(config, fetchAll, now);
        } finally {
          refreshing = null;
        }
      };
      refreshing = Promise.resolve(schedule(run)).then(() => undefined);
    }
    return { chats: cached.chats, refreshing: true };
  }

  return { chats: await readAndRemember(config, fetchAll, now), refreshing: false };
}

export async function listChats(
  config: Config,
  options: { offset?: number } = {},
): Promise<{ chats: PocChat[]; hasMore: boolean }> {
  const offset = options.offset ?? 0;
  const { chats: merged } = await loadMergedChats(config);
  return {
    chats: merged.slice(offset, offset + CHAT_PAGE_SIZE),
    hasMore: offset + CHAT_PAGE_SIZE < merged.length,
  };
}

export async function getChat(config: { apiKey: string; accountId: string }, chatId: string): Promise<PocChat | null> {
  const body = await call(config, `/chats/${encodeURIComponent(chatId)}`);
  return toPocChat(body as RawChat);
}

/// The WhatsApp address of a number: "+972541234567" gives
/// "972541234567@s.whatsapp.net". Null for anything that is not E.164.
export function whatsappAddress(phone: string | null): string | null {
  if (!phone || !/^\+\d{8,15}$/.test(phone)) return null;
  return `${phone.slice(1)}@s.whatsapp.net`;
}

/// A 1:1 chat found by the other side's number, or null when there is no
/// such WhatsApp user or no chat with them.
///
/// 31.10.2026: needed because Unipile's chat list did not move a chat up
/// when new messages arrived in it. A chat active today could sit far
/// below 30 chats whose last activity was the day before, so the list
/// alone could not reach it.
export async function findChatByPhone(
  config: { apiKey: string; accountId: string },
  phone: string,
): Promise<PocChat | null> {
  const address = whatsappAddress(phone);
  if (!address) return null;
  try {
    const profile = await call(config, `/users/${encodeURIComponent(address)}`);
    const userId = str((profile as { id?: unknown } | null)?.id);
    if (!userId) return null;
    return await getChat(config, userId);
  } catch (err) {
    if (err instanceof UnipileError && err.status === 404) return null;
    throw err;
  }
}

/// Newest first from Unipile; returned oldest first, as a conversation reads.
export async function listMessages(
  config: { apiKey: string; accountId: string },
  chatId: string,
  limit = 40,
): Promise<PocMessage[]> {
  const body = await call(config, `/chats/${encodeURIComponent(chatId)}/messages`, { query: { limit: String(limit) } });
  return dataArray(body)
    .map((m) => toPocMessage(m as RawMessage))
    .filter((m): m is PocMessage => m !== null)
    .reverse();
}

export async function sendText(config: { apiKey: string; accountId: string }, chatId: string, text: string): Promise<void> {
  await call(config, `/chats/${encodeURIComponent(chatId)}/messages/send`, { method: "POST", body: { text } });
}
