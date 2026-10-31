import "server-only";
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
};

export function readPocConfig(): PocConfig {
  const apiKey = process.env.UNIPILE_API_KEY?.trim() || null;
  const rawAccount = process.env.UNIPILE_WHATSAPP_ACCOUNT_ID?.trim() || "";
  const accountId = /^acc_[A-Za-z0-9]+$/.test(rawAccount) ? rawAccount : null;
  return {
    apiKey,
    accountId,
    viewers: parseEmailList(process.env.WHATSAPP_POC_VIEWERS),
    sendTo: parsePhoneList(process.env.WHATSAPP_POC_SEND_TO),
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

export type PocAttachment = { type: string; mimetype: string | null; voiceNote: boolean };

export type PocMessage = {
  id: string;
  text: string;
  timestamp: string;
  isSender: boolean;
  senderName: string | null;
  attachments: PocAttachment[];
  isDeleted: boolean;
};

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
  attachments?: Array<{ type?: unknown; mimetype?: unknown; voice_note?: unknown }> | null;
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
      type: str(a.type) ?? "file",
      mimetype: str(a.mimetype),
      voiceNote: a.voice_note === true,
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
const MAX_OFFSET = 3000;

/// The page offset from the URL: a whole multiple of the page size, or 0.
///
/// 31.10.2026: Unipile pages WhatsApp chats by offset. It returns no
/// next_cursor for this provider, so a cursor-based "older" link never
/// appeared.
export function parseOffset(raw: string | undefined | null): number {
  if (!raw || !/^\d{1,5}$/.test(raw)) return 0;
  const n = Number(raw);
  if (n > MAX_OFFSET || n % CHAT_PAGE_SIZE !== 0) return 0;
  return n;
}

export async function listChats(
  config: { apiKey: string; accountId: string },
  options: { offset?: number } = {},
): Promise<{ chats: PocChat[]; hasMore: boolean }> {
  const offset = options.offset ?? 0;
  const query: Record<string, string> = { limit: String(CHAT_PAGE_SIZE) };
  if (offset > 0) query.offset = String(offset);
  const body = await call(config, "/chats", { query });
  const raw = dataArray(body);
  const chats = raw
    .map((c) => toPocChat(c as RawChat))
    .filter((c): c is PocChat => c !== null && !isHiddenChat(c));
  // A full page means there may be more. Counted before the status feed is
  // dropped, so that one hidden chat does not end the list early.
  return { chats, hasMore: raw.length >= CHAT_PAGE_SIZE && offset + CHAT_PAGE_SIZE <= MAX_OFFSET };
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
