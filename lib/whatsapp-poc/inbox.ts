import { normalizePhone } from "@/lib/contact-normalize";

// Communications screen (1.11.2026, Ariel's design review): WhatsApp chats
// and the Aloha line's call recordings in one list, one row per person,
// and one timeline per person that mixes both. Until now the recordings
// sat on their own page behind a link, so a call and the WhatsApp
// messages around it could not be read together.
//
// Pure functions only: the screen reads chats, recordings and the client
// files, and these put them together. Nothing here talks to Unipile or
// the database, so it is all covered by unit tests.

export type InboxFilter = "all" | "wa" | "call" | "none";

/// The type menu's choices, in order. Their labels are the screen's
/// (messages/*.json, comms.filters).
export const INBOX_FILTERS: InboxFilter[] = ["all", "wa", "call", "none"];

/// The row of recordings Aloha sent by hand for one of our lines, with no
/// other side (page.tsx). Like NO_NAME, the screen shows its own word.
export const LINE_RECORDINGS_NAME = "הקלטות בלי מספר הצד השני";

/// The name a chat gets when WhatsApp gives none (lib/whatsapp-poc/unipile.ts).
/// It is stored with the chat and compared on, so it stays as it is; a screen
/// shows its own word for it (ADR 0006).
export const NO_NAME = "ללא שם";

export function parseFilter(raw: string | undefined | null): InboxFilter {
  return raw === "wa" || raw === "call" || raw === "none" ? raw : "all";
}

/// What the list and the timeline need of a chat and of a recording. The
/// Unipile and recordings modules map to these.
export type InboxChat = {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  /// Set when the preview is a word for an attachment, not text someone
  /// wrote (lib/comms/stored-chats.ts).
  lastMessageKind?: "voice" | "file" | null;
  groupClient?: { id: string; name: string } | null;
  /// Which connected number the chat was read from (lib/comms/inbox-loader.ts):
  /// the channel id, or "-" for the configured number before it was
  /// connected. 12.11.2026: a WhatsApp chat id is the other person's id, so
  /// two of our numbers talking to the same person have chats with the same
  /// id; only the id and the number together name one conversation.
  numberKey?: string;
};

/// One conversation: a chat on one of our numbers.
export type ChatRef = { chatId: string; numberKey: string | null };

export type InboxCall = {
  emailId: string;
  callAt: string;
  direction: "in" | "out" | "unknown";
  /// The number on the other side, in E.164.
  other: string;
};

export type PreviewKind = "callIn" | "callOut" | "call" | "voice" | "file";

export type ClientRef = { id: string; name: string };
export type PhoneOwner = { personName: string | null; clients: ClientRef[] };

export type InboxRow = {
  /// "p:+972..." for a number, "c:<chat id>" for a chat with no number
  /// (a group). Stable across loads, so it can sit in the URL.
  key: string;
  name: string;
  phone: string | null;
  chatId: string | null;
  /// The channel of the latest activity, for the icon.
  channel: "wa" | "call";
  hasWhatsapp: boolean;
  hasCalls: boolean;
  preview: string;
  /// What the preview stands for when it is not a message's own text, so a
  /// screen can word it in the reader's language (ADR 0006). `preview`
  /// keeps the Hebrew word.
  previewKind: PreviewKind | null;
  at: string | null;
  unreadCount: number;
  clients: ClientRef[];
  /// The people whose number or line this row's chats and calls are on
  /// (5.11.2026, the "צוות" filter): user ids.
  teamIds: string[];
  /// The WhatsApp chats behind the row, for "סמן כנקראה" (5.11.2026), each
  /// with its number (12.11.2026: the same chat id can be on two numbers).
  chats: ChatRef[];
};

/// Who each chat and call belongs to, for the "צוות" filter. Optional: a
/// list built without it has no team on any row.
export type TeamOf = {
  /// By the chat itself, not its id: the same id can be on two numbers.
  chat?: (chat: InboxChat) => string | null | undefined;
  call?: (call: InboxCall) => string | null | undefined;
};

function refOf(chat: InboxChat): ChatRef {
  return { chatId: chat.id, numberKey: chat.numberKey ?? null };
}

function addTeam(row: InboxRow, id: string | null | undefined) {
  if (id && !row.teamIds.includes(id)) row.teamIds.push(id);
}

/// WhatsApp reports a chat marked unread by hand with no count (5.11.2026):
/// any count other than zero is unread.
export function isUnread(row: Pick<InboxRow, "unreadCount">): boolean {
  return row.unreadCount !== 0;
}

export function phoneKey(phone: string): string {
  return `p:${phone}`;
}

export function chatKey(chatId: string): string {
  return `c:${chatId}`;
}

/// The key in the URL, read back. Anything else is ignored.
export function parseKey(raw: string | undefined | null): { phone: string } | { chatId: string } | null {
  if (!raw || raw.length > 220) return null;
  if (raw.startsWith("p:")) {
    const phone = normalizePhone(raw.slice(2));
    return phone && /^\+\d{8,15}$/.test(phone) ? { phone } : null;
  }
  if (raw.startsWith("c:") && raw.length > 2) return { chatId: raw.slice(2) };
  return null;
}

/// A chat's number in E.164, or null (groups, or a number Unipile did not
/// give).
export function chatPhone(chat: Pick<InboxChat, "type" | "phone">): string | null {
  if (chat.type !== "1to1" || !chat.phone) return null;
  const phone = normalizePhone(chat.phone);
  return phone && /^\+\d{8,15}$/.test(phone) ? phone : null;
}

/// Whether a "+digits" value looks like a real phone number, for display.
///
/// 1.11.2026: some WhatsApp chats carry an internal id (a "LID") where the
/// number would be, and it comes out of normalizePhone as "+1411671528...".
/// Those are 14 or 15 digits, or start with a country code that cannot be
/// that long. They still identify the chat (and its block), so they are
/// kept as they are; the screens just do not call them a phone number.
export function isPlausiblePhone(phone: string | null | undefined): boolean {
  if (!phone || !/^\+\d{8,15}$/.test(phone)) return false;
  const digits = phone.slice(1);
  if (digits.length >= 14) return false;
  if (digits.startsWith("1")) return digits.length === 11;
  if (digits.startsWith("972")) return digits.length === 11 || digits.length === 12;
  return true;
}

/// A number as the screens show it: the number, or a plain word for an id.
/// A translated screen passes its own word (ADR 0006).
export function displayPhone(phone: string | null | undefined, notAPhone = "מזהה WhatsApp (לא מספר טלפון)"): string {
  if (!phone) return "";
  return isPlausiblePhone(phone) ? phone : notAPhone;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/// Two chats with the same person: counts add up; a chat marked unread by
/// hand (a negative count) keeps the row unread.
function mergeUnread(a: number, b: number): number {
  if (a > 0 || b > 0) return Math.max(a, 0) + Math.max(b, 0);
  return a !== 0 || b !== 0 ? -1 : 0;
}

const CALL_PREVIEW = { in: "שיחה נכנסת", out: "שיחה יוצאת", unknown: "שיחה" } as const;
const CALL_PREVIEW_KIND = { in: "callIn", out: "callOut", unknown: "call" } as const;

function later(a: string | null, b: string | null): boolean {
  if (!b) return false;
  if (!a) return true;
  return new Date(b).getTime() > new Date(a).getTime();
}

/// One row per person: a WhatsApp chat and the calls with the same number
/// become one row, whose preview and time are those of the latest of
/// them. Newest first.
export function buildInbox(chats: InboxChat[], calls: InboxCall[], owners: Map<string, PhoneOwner>, teamOf: TeamOf = {}): InboxRow[] {
  const rows = new Map<string, InboxRow>();

  for (const chat of chats) {
    const phone = chatPhone(chat);
    const key = phone ? phoneKey(phone) : chatKey(chat.id);
    const owner = phone ? owners.get(phone) : undefined;
    // Two numbers may each have a chat with the same person: one row, the
    // latest activity of the two.
    const seen = rows.get(key);
    if (seen && !later(seen.at, chat.lastMessageAt)) {
      seen.unreadCount = mergeUnread(seen.unreadCount, chat.unreadCount);
      seen.chats.push(refOf(chat));
      addTeam(seen, teamOf.chat?.(chat));
      continue;
    }
    const row: InboxRow = {
      key,
      name: chat.name,
      phone,
      chatId: chat.id,
      channel: "wa",
      hasWhatsapp: true,
      hasCalls: false,
      preview: chat.lastMessagePreview ?? "",
      previewKind: chat.lastMessageKind ?? null,
      at: chat.lastMessageAt,
      unreadCount: seen ? mergeUnread(seen.unreadCount, chat.unreadCount) : chat.unreadCount,
      // A group has no number; it belongs to a client only when assigned.
      clients: owner?.clients ?? (chat.groupClient ? [chat.groupClient] : []),
      teamIds: seen ? [...seen.teamIds] : [],
      chats: seen ? [...seen.chats, refOf(chat)] : [refOf(chat)],
    };
    addTeam(row, teamOf.chat?.(chat));
    rows.set(key, row);
  }

  for (const call of calls) {
    const key = phoneKey(call.other);
    const owner = owners.get(call.other);
    const existing = rows.get(key);
    const preview = CALL_PREVIEW[call.direction];
    if (!existing) {
      rows.set(key, {
        key,
        name: owner?.personName ?? displayPhone(call.other),
        phone: call.other,
        chatId: null,
        channel: "call",
        hasWhatsapp: false,
        hasCalls: true,
        preview,
        previewKind: CALL_PREVIEW_KIND[call.direction],
        at: call.callAt,
        unreadCount: 0,
        clients: owner?.clients ?? [],
        teamIds: [],
        chats: [],
      });
      addTeam(rows.get(key)!, teamOf.call?.(call));
      continue;
    }
    addTeam(existing, teamOf.call?.(call));
    existing.hasCalls = true;
    if (later(existing.at, call.callAt)) {
      existing.at = call.callAt;
      existing.preview = preview;
      existing.previewKind = CALL_PREVIEW_KIND[call.direction];
      existing.channel = "call";
    }
  }

  // A name from the client file beats the number Unipile shows for
  // someone whose WhatsApp profile has no name.
  for (const row of rows.values()) {
    const ownerName = row.phone ? owners.get(row.phone)?.personName : null;
    if (ownerName && (row.name === row.phone || row.name === NO_NAME)) row.name = ownerName;
  }

  return [...rows.values()].sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return tb - ta;
  });
}

/// The list under the filter chips and the search box.
export function filterInbox(rows: InboxRow[], filter: InboxFilter, query: string, team: string | null = null): InboxRow[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return rows.filter((row) => {
    if (team && !row.teamIds.includes(team)) return false;
    if (filter === "wa" && !row.hasWhatsapp) return false;
    if (filter === "call" && !row.hasCalls) return false;
    if (filter === "none" && (row.clients.length > 0 || !row.phone)) return false;
    if (!q) return true;
    if (row.name.toLowerCase().includes(q)) return true;
    if (row.clients.some((c) => c.name.toLowerCase().includes(q))) return true;
    // "054-123" finds "+97254123...": the local number without its zero.
    if (digits.length >= 3 && row.phone) {
      const local = digits.startsWith("0") ? digits.slice(1) : digits;
      if (row.phone.replace(/\D/g, "").includes(local)) return true;
    }
    return false;
  });
}

export type TimelineMessage = { kind: "message"; at: string; id: string };
export type TimelineCall = { kind: "call"; at: string; id: string };
export type TimelineItem = TimelineMessage | TimelineCall;

/// Messages and calls in one line, oldest first, as WhatsApp reads: the
/// latest item sits at the bottom, beside the reply box (Ariel, 5.11.2026;
/// from 3.11.2026 it was newest first, and the reply box ended up below a
/// long scroll).
export function buildTimeline(messages: Array<{ id: string; timestamp: string }>, calls: InboxCall[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((m) => ({ kind: "message" as const, at: m.timestamp, id: m.id })),
    ...calls.map((c) => ({ kind: "call" as const, at: c.callAt, id: c.emailId })),
  ];
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/// Day headings in the timeline ("יום ראשון, 1 בנובמבר"), Israel time.
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

export function countSince<T>(items: T[], at: (item: T) => string, since: Date): number {
  const t = since.getTime();
  return items.filter((item) => new Date(at(item)).getTime() >= t).length;
}

/// The task the "צור משימה מהשיחה" button proposes. The person edits both
/// before anything is saved.
export function proposeTask(input: {
  name: string;
  phone: string | null;
  lastMessages: Array<{ text: string; isSender: boolean }>;
  lastCall: { at: string; direction: "in" | "out" | "unknown" } | null;
  /// The latest call's stored transcript, when there is one.
  transcript?: string | null;
}): { title: string; description: string } {
  const who = input.name || input.phone || "איש קשר";
  const lines: string[] = [];
  if (input.phone) lines.push(`מספר: ${input.phone}`);
  if (input.lastCall) {
    const when = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(
      new Date(input.lastCall.at),
    );
    lines.push(`${CALL_PREVIEW[input.lastCall.direction]} אחרונה: ${when}`);
  }
  const texts = input.lastMessages.filter((m) => m.text.trim()).slice(-5);
  if (texts.length > 0) {
    lines.push("", "הודעות אחרונות:");
    for (const m of texts) lines.push(`${m.isSender ? "אנחנו" : who}: ${m.text.trim().slice(0, 300)}`);
  }
  if (input.transcript?.trim()) {
    lines.push("", "תמלול השיחה האחרונה:", input.transcript.trim().slice(0, 3000));
  }
  return { title: `מעקב: שיחה עם ${who}`, description: lines.join("\n") };
}

/// The part of a message around the first match, for the results list.
export function snippetAround(text: string, query: string, radius = 60): { before: string; match: string; after: string } {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(query.trim().toLowerCase());
  if (i < 0) return { before: flat.slice(0, radius * 2), match: "", after: "" };
  const end = i + query.trim().length;
  const start = Math.max(0, i - radius);
  return {
    before: (start > 0 ? "…" : "") + flat.slice(start, i),
    match: flat.slice(i, end),
    after: flat.slice(end, end + radius) + (end + radius < flat.length ? "…" : ""),
  };
}
