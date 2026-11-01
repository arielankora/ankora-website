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

export const INBOX_FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: "all", label: "הכל" },
  { id: "wa", label: "WhatsApp" },
  { id: "call", label: "שיחות טלפון" },
  { id: "none", label: "לא משויך ללקוח" },
];

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
};

export type InboxCall = {
  emailId: string;
  callAt: string;
  direction: "in" | "out" | "unknown";
  /// The number on the other side, in E.164.
  other: string;
};

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
  at: string | null;
  unreadCount: number;
  clients: ClientRef[];
};

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
export function displayPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return isPlausiblePhone(phone) ? phone : "מזהה WhatsApp (לא מספר טלפון)";
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const CALL_PREVIEW = { in: "שיחה נכנסת", out: "שיחה יוצאת", unknown: "שיחה" } as const;

function later(a: string | null, b: string | null): boolean {
  if (!b) return false;
  if (!a) return true;
  return new Date(b).getTime() > new Date(a).getTime();
}

/// One row per person: a WhatsApp chat and the calls with the same number
/// become one row, whose preview and time are those of the latest of
/// them. Newest first.
export function buildInbox(chats: InboxChat[], calls: InboxCall[], owners: Map<string, PhoneOwner>): InboxRow[] {
  const rows = new Map<string, InboxRow>();

  for (const chat of chats) {
    const phone = chatPhone(chat);
    const key = phone ? phoneKey(phone) : chatKey(chat.id);
    const owner = phone ? owners.get(phone) : undefined;
    rows.set(key, {
      key,
      name: chat.name,
      phone,
      chatId: chat.id,
      channel: "wa",
      hasWhatsapp: true,
      hasCalls: false,
      preview: chat.lastMessagePreview ?? "",
      at: chat.lastMessageAt,
      unreadCount: chat.unreadCount,
      clients: owner?.clients ?? [],
    });
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
        at: call.callAt,
        unreadCount: 0,
        clients: owner?.clients ?? [],
      });
      continue;
    }
    existing.hasCalls = true;
    if (later(existing.at, call.callAt)) {
      existing.at = call.callAt;
      existing.preview = preview;
      existing.channel = "call";
    }
  }

  // A name from the client file beats the number Unipile shows for
  // someone whose WhatsApp profile has no name.
  for (const row of rows.values()) {
    const ownerName = row.phone ? owners.get(row.phone)?.personName : null;
    if (ownerName && (row.name === row.phone || row.name === "ללא שם")) row.name = ownerName;
  }

  return [...rows.values()].sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return tb - ta;
  });
}

/// The list under the filter chips and the search box.
export function filterInbox(rows: InboxRow[], filter: InboxFilter, query: string): InboxRow[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return rows.filter((row) => {
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

/// Messages and calls in one line, oldest first, as a conversation reads.
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
