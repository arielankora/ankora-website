// WhatsApp POC (31.10.2026): who may see the screen, and who may be
// written to from it. Pure: no Prisma, no environment, no clock.
//
// The POC runs on Ariel's own WhatsApp number through Unipile. That number
// carries his personal chats, so "admin" is not enough to see it: the
// screen is limited to an explicit list of addresses (Ariel and Hadas),
// and an empty list means nobody, never everybody.
//
// Sending: until 5.11.2026 a message left only to a number on an explicit
// test list. Since then (Ariel's decision) replies are open, from the
// person's own number, to one to one chats and groups; the test list
// remains as a kill switch (canReplyTo). The chat is always read back from
// Unipile, never from the form, and a message is still only ever sent by a
// person pressing "שליחה" (the rule of 25.9.2026).
import type { UserRole } from "@prisma/client";
import { normalizeEmail, normalizePhone } from "@/lib/contact-normalize";

export const MAX_MESSAGE_LENGTH = 1000;

const ROLES_THAT_MAY_VIEW: ReadonlySet<UserRole> = new Set<UserRole>(["SUPER_ADMIN", "ANKORA_ADMIN"]);

function splitList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/// Addresses, normalized, without duplicates. Entries that are not
/// addresses are dropped: a typo must never widen access.
export function parseEmailList(raw: string | undefined | null): string[] {
  const out = new Set<string>();
  for (const entry of splitList(raw)) {
    const email = normalizeEmail(entry);
    if (email) out.add(email);
  }
  return [...out];
}

/// Numbers in E.164 form, without duplicates. An entry that does not come
/// out as "+" and digits is dropped.
export function parsePhoneList(raw: string | undefined | null): string[] {
  const out = new Set<string>();
  for (const entry of splitList(raw)) {
    const phone = normalizePhone(entry);
    if (phone && /^\+\d{8,15}$/.test(phone)) out.add(phone);
  }
  return [...out];
}

export function canViewWhatsappPoc(user: { role: UserRole; email: string }, viewers: readonly string[]): boolean {
  if (!ROLES_THAT_MAY_VIEW.has(user.role)) return false;
  const email = normalizeEmail(user.email);
  if (!email) return false;
  return viewers.includes(email);
}

/// The chat's own number against the list. `publicIdentifier` is what
/// Unipile reports for the other side of a 1:1 chat ("+972..."); anything
/// else, a group or a chat with no number, is refused.
export function canSendTo(publicIdentifier: string | null | undefined, allowlist: readonly string[]): boolean {
  if (!publicIdentifier) return false;
  const phone = normalizePhone(publicIdentifier);
  if (!phone || !phone.startsWith("+")) return false;
  return allowlist.includes(phone);
}

/// 5.11.2026 (Ariel): replies are open. Whoever owns a number answers its
/// chats, one to one and groups, from that number. WHATSAPP_POC_SEND_MODE
/// set to "test" brings back the test list (WHATSAPP_POC_SEND_TO) as a kill
/// switch, without a code change; anything else, or nothing, is open.
export type SendMode = "open" | "test";

export function parseSendMode(raw: string | undefined | null): SendMode {
  return raw?.trim().toLowerCase() === "test" ? "test" : "open";
}

/// Whether a chat may be answered under the mode. The sender's ownership of
/// the number, and the block list, are checked by the caller.
export function canReplyTo(
  chat: { type: string; phone: string | null; readOnly?: boolean },
  mode: SendMode,
  allowlist: readonly string[],
): boolean {
  if (chat.readOnly) return false;
  if (mode === "test") return chat.type === "1to1" && canSendTo(chat.phone, allowlist);
  return chat.type === "1to1" || chat.type === "group";
}

/// `code` names the refusal for a translated screen (ADR 0006); `error` is
/// the Hebrew sentence it always was.
export type MessageTextCheck = { ok: true; text: string } | { ok: false; error: string; code: "empty" | "tooLong" };

export function checkMessageText(raw: unknown): MessageTextCheck {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "ההודעה ריקה.", code: "empty" };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `ההודעה ארוכה מדי (עד ${MAX_MESSAGE_LENGTH} תווים).`, code: "tooLong" };
  }
  return { ok: true, text };
}

/// "+972524645088" shown as "+972 ••• 5088": enough to recognise one's own
/// test number, without putting a full number in the audit log.
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "•••";
  return `+${digits.slice(0, 3)} ••• ${digits.slice(-4)}`;
}
