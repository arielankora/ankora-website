import { addBusinessDays } from "@/lib/business-calendar";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";

// Stage 2 of "התיבות שלי" (27.11.2026): the pure rules of following a reply
// to an email on a task, unit tested without a database
// (tests/unit/mail-wait-rules.test.ts).

/// Ariel, 27.11.2026: "יומיים עבודה".
export const REMIND_BUSINESS_DAYS = 2;
/// A thread the owner sent to someone who is no client's is kept this long,
/// so it can be picked; then it goes, unless a task follows it.
export const SENT_KEEP_DAYS = 14;

/// The default reminder: two working days (Israel) after `from`, at the
/// same wall-clock time.
export function defaultRemindAt(from: Date): Date {
  const day = addBusinessDays(localDateKey(from, TIMEZONE), REMIND_BUSINESS_DAYS, "IL");
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(from);
  return localDateTimeToUtc(day, time, TIMEZONE);
}

export type WaitLike = { endedAt: Date | null; endedHow: "REPLY" | "STOPPED" | "REPLACED" | null; remindAt: Date | null };
export type WaitState = "waiting" | "overdue" | "replied" | "stopped";

export function waitState(w: WaitLike, now = new Date()): WaitState {
  if (w.endedAt) return w.endedHow === "REPLY" ? "replied" : "stopped";
  return w.remindAt && w.remindAt <= now ? "overdue" : "waiting";
}

/// Whether a new email in a followed thread is the reply: written by
/// someone other than the mailbox that sent the followed email.
export function isReply(from: string | null, mailboxAddress: string): boolean {
  return Boolean(from && from !== mailboxAddress.trim().toLowerCase());
}

/// Whom an email the owner sent went to: everyone in it but the mailbox.
export function recipientsOf(participants: readonly string[], mailboxAddress: string): string[] {
  const me = mailboxAddress.trim().toLowerCase();
  return participants.filter((p) => p !== me);
}

export type Candidate = { threadId: string; sentTo: string[]; sentAt: Date; clientIds: string[] };

/// "מוצע": the newest email sent to someone in the task's client's world
/// (a thread with that client); else the newest email of all.
export function suggestCandidate(candidates: readonly Candidate[], clientId: string | null): string | null {
  const sorted = [...candidates].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  const withClient = clientId ? sorted.find((c) => c.clientIds.includes(clientId)) : undefined;
  return (withClient ?? sorted[0])?.threadId ?? null;
}

/// A reminder time from a form or the connector: an ISO time, or the
/// local "YYYY-MM-DDTHH:MM" of a datetime-local field (Israel time). Null
/// when it is not one, or not in the future.
export function parseRemindAt(raw: string | null | undefined, now = new Date()): Date | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(text);
  const at = local ? localDateTimeToUtc(local[1], local[2], TIMEZONE) : /^\d{4}-\d{2}-\d{2}$/.test(text) ? localDateTimeToUtc(text, "09:00", TIMEZONE) : new Date(text);
  if (Number.isNaN(at.getTime()) || at <= now) return null;
  return at;
}

/// A time as a datetime-local field shows it, in Israel time ("YYYY-MM-DDTHH:MM").
export function toLocalInput(at: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return `${localDateKey(at, TIMEZONE)}T${time}`;
}
