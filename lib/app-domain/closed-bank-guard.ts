// 3.11.2026, Ariel: "לא רושמים בחבילה סגורה".
//
// The moment a new package is loaded or a new cycle opened, the previous
// one is closed, and nothing is reported into it any more. RIMED showed why:
// a manual entry created on 2.11 after the load, starting at 01:00 that
// night, fell inside the package that had just closed. Its closing balance
// moved by 25 minutes, but the carry into the new package had already been
// written, so those minutes never reached the balance anyone reports.
//
// The rule, as Ariel approved it (task cmvxjhbgj000hii085escrx7v):
// - a new entry whose start falls inside a closed bank is refused, with an
//   offer to record it in the open one instead, moved to the moment that
//   one opened and carrying a line that says when the work was done;
// - editing, deleting, restoring or reopening an entry inside a closed bank
//   is refused too. A manager (SUPER_ADMIN, ANKORA_ADMIN) may override it,
//   only with a reason, after being asked whether they are sure. Every
//   override lands in the audit log and flags the bank RECALCULATED;
// - a timer still running when its bank closed by date always stops, and
//   the person is then asked whether to move it into the open bank.
//
// This file holds the pure part: which bank is closed, which is open, and
// what a moved entry looks like. lib/app-domain/time-entries.ts enforces it.

import type { HourBank, HourBankStatus, UserRole } from "@prisma/client";
import { localDateKey } from "@/lib/timezone";
import { DomainError } from "@/lib/domain-error";

export type GuardBank = Pick<HourBank, "id" | "kind" | "cycleStart" | "cycleEnd" | "status">;

/// Closed: marked so, or past its end even if no screen has flipped the
/// status yet (closeIfExpired in hour-banks.ts does that lazily on read).
export function isBankClosed(bank: Pick<GuardBank, "status" | "cycleEnd">, now: Date): boolean {
  return (bank.status as HourBankStatus) !== "OPEN" || bank.cycleEnd.getTime() <= now.getTime();
}

/// The bank an instant belongs to: the same half-open range
/// [cycleStart, cycleEnd) the consumption totals use.
export function bankContaining<T extends GuardBank>(banks: T[], at: Date): T | null {
  const t = at.getTime();
  return banks.find((b) => b.cycleStart.getTime() <= t && t < b.cycleEnd.getTime()) ?? null;
}

/// The bank that covers "now" and is still open.
export function openBankAt<T extends GuardBank>(banks: T[], now: Date): T | null {
  const b = bankContaining(banks, now);
  return b && !isBankClosed(b, now) ? b : null;
}

export type ClosedBankHit = {
  closed: { id: string; kind: GuardBank["kind"]; cycleStart: Date; cycleEnd: Date };
  open: { id: string; kind: GuardBank["kind"]; cycleStart: Date } | null;
};

/// The closed bank that `at` falls in, with the bank open now, or null when
/// `at` is in an open bank or in no bank at all (a client without an hour
/// bank, or an entry from before the first one, is not affected).
export function closedBankHit(banks: GuardBank[], at: Date, now: Date): ClosedBankHit | null {
  const b = bankContaining(banks, at);
  if (!b || !isBankClosed(b, now)) return null;
  const open = openBankAt(banks, now);
  return {
    closed: { id: b.id, kind: b.kind, cycleStart: b.cycleStart, cycleEnd: b.cycleEnd },
    open: open ? { id: open.id, kind: open.kind, cycleStart: open.cycleStart } : null,
  };
}

/// Who may override the rule. Narrower than hour_bank.manage on purpose:
/// it is the same pair that sees adjustments in get_hours_bank.
export function canOverrideClosedBank(role: UserRole): boolean {
  return role === "SUPER_ADMIN" || role === "ANKORA_ADMIN";
}

const dayLabel = (d: Date) => {
  const [y, m, day] = localDateKey(d).split("-");
  return `${Number(day)}.${Number(m)}.${y}`;
};

/// "החבילה מ-11.10.2026 נסגרה ב-2.11.2026."
export function closedSentence(hit: ClosedBankHit): string {
  const c = hit.closed;
  return c.kind === "PREPAID"
    ? `החבילה מ-${dayLabel(c.cycleStart)} נסגרה ב-${dayLabel(c.cycleEnd)}.`
    : `המחזור מ-${dayLabel(c.cycleStart)} נסגר ב-${dayLabel(c.cycleEnd)}.`;
}

/// The sentence every surface shows for a new entry. Hebrew, because
/// screens surface err.message as it is.
export function closedBankMessage(hit: ClosedBankHit): string {
  if (!hit.open) return `${closedSentence(hit)} אין כרגע חבילה או מחזור פתוחים ללקוח, ולכן אי אפשר לרשום את הזמן.`;
  return `${closedSentence(hit)} לרשום את הזמן ${hit.open.kind === "PREPAID" ? "בחבילה הפתוחה" : "במחזור הפתוח"}?`;
}

/// After a stop that crossed a closure: the question the person is asked.
export function stoppedAcrossClosureMessage(hit: ClosedBankHit): string {
  const where = hit.open?.kind === "PREPAID" ? "לחבילה הפתוחה" : "למחזור הפתוח";
  return `${closedSentence(hit)} הטיימר רץ בזמן הסגירה, ולכן הוא נרשם בה. להעביר את הרישום ${where}?`;
}

/// The warning a manager sees before overriding (Ariel's wording).
/// A screen in the reader's language shows the dictionary key
/// OVERRIDE_WARNING_KEY instead; this sentence stays for MCP.
export const OVERRIDE_WARNING = "אתה עומד לשנות חבילה או מחזור סגורים. האם אתה בטוח שאתה רוצה לבצע שינוי כזה?";
export const OVERRIDE_WARNING_KEY = "domainErrors.closedBank.overrideWarning";

/// ADR 0006: the values every closedBank.* sentence takes. `kind` and
/// `openKind` are HourBankKind ("PREPAID" or "CYCLE"; "none" when there
/// is no open bank), chosen with an ICU select in the dictionary.
export function closedBankValues(hit: ClosedBankHit): { kind: string; start: string; end: string; openKind: string } {
  return { kind: hit.closed.kind, start: dayLabel(hit.closed.cycleStart), end: dayLabel(hit.closed.cycleEnd), openKind: hit.open?.kind ?? "none" };
}

/// The dictionary key for stoppedAcrossClosureMessage(hit), with
/// closedBankValues(hit) as its values.
export const STOPPED_ACROSS_CLOSURE_KEY = "domainErrors.closedBank.stoppedAcrossClosure";

/// The line added to the note of an entry moved into the open bank.
export function movedEntryNoteLine(originalStart: Date, closed: { kind: GuardBank["kind"]; cycleEnd: Date }): string {
  const noun = closed.kind === "PREPAID" ? "החבילה" : "המחזור";
  return `עבודה מ-${dayLabel(originalStart)}, נרשמה אחרי סגירת ${noun} ב-${dayLabel(closed.cycleEnd)}`;
}

export function appendNoteLine(note: string | null | undefined, line: string): string {
  const base = note?.trim();
  if (!base) return line;
  if (base.includes(line)) return base;
  return `${base}\n${line}`;
}

/// Where a moved entry lands: it starts the moment the open bank opened
/// and keeps its length.
export function movedRange(open: { cycleStart: Date }, startAt: Date, endAt: Date): { startAt: Date; endAt: Date } {
  const length = endAt.getTime() - startAt.getTime();
  return { startAt: new Date(open.cycleStart.getTime()), endAt: new Date(open.cycleStart.getTime() + length) };
}

/// Thrown by every time-entry write that lands in a closed bank.
/// `canOverride` tells the caller whether to offer a manager the override,
/// `canMoveToOpen` whether to offer recording it in the open bank instead.
export class ClosedBankError extends DomainError {
  constructor(
    public readonly hit: ClosedBankHit,
    public readonly action: "create" | "change",
    public readonly canOverride: boolean
  ) {
    // closedChange and closedNoOpen take {kind, start, end};
    // closedMoveToOpen takes {openKind} too.
    const { kind, start, end, openKind } = closedBankValues(hit);
    super(
      action === "change" ? "closedBank.closedChange" : hit.open ? "closedBank.closedMoveToOpen" : "closedBank.closedNoOpen",
      action === "create"
        ? closedBankMessage(hit)
        : `${closedSentence(hit)} אי אפשר לשנות רישום בחבילה או מחזור סגורים.`,
      action === "create" && hit.open ? { kind, start, end, openKind } : { kind, start, end }
    );
    this.name = "ClosedBankError";
  }

  get canMoveToOpen(): boolean {
    return this.action === "create" && !!this.hit.open;
  }
}

/// Thrown when an override is asked for without a reason.
export class ClosedBankOverrideReasonRequiredError extends DomainError {
  constructor() {
    super("closedBank.overrideReasonRequired", "שינוי בחבילה או מחזור סגורים דורש סיבה.");
    this.name = "ClosedBankOverrideReasonRequiredError";
  }
}

/// Loading a package or opening a cycle waits for the client's running
/// timers to stop: a timer that began before the load and stopped after it
/// would otherwise land in the bank that just closed.
export type RunningTimerOnClient = { employeeName: string; startAt: Date };

export class RunningTimersOnClientError extends Error {
  constructor(public readonly timers: RunningTimerOnClient[]) {
    super(
      `רצים כרגע טיימרים על הלקוח: ${timers
        .map((t) => `${t.employeeName} מ-${new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(t.startAt)}`)
        .join(", ")}. אפשר לטעון חבילה או לפתוח מחזור רק אחרי שהם נעצרים.`
    );
    this.name = "RunningTimersOnClientError";
  }
}
