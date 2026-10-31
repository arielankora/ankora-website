// WhatsApp POC (31.10.2026): who may see the screen, and who may be
// written to from it. Pure: no Prisma, no environment, no clock.
//
// The POC runs on Ariel's own WhatsApp number through Unipile. That number
// carries his personal chats, so "admin" is not enough to see it: the
// screen is limited to an explicit list of addresses (Ariel and Hadas),
// and an empty list means nobody, never everybody.
//
// Sending is narrower still. A message leaves only to a number on an
// explicit list, and the number is read from the chat Unipile returns,
// never from the form. That keeps the POC inside the rule that tests go
// only to Ariel or Hadas, and inside the rule of 25.9.2026 that nothing
// reaches a client without a person choosing to send it.
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

export type MessageTextCheck = { ok: true; text: string } | { ok: false; error: string };

export function checkMessageText(raw: unknown): MessageTextCheck {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "ההודעה ריקה." };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `ההודעה ארוכה מדי (עד ${MAX_MESSAGE_LENGTH} תווים).` };
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
