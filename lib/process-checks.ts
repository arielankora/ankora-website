// The check of an ongoing process (claude/org-brain-spec-2026-10-12.md,
// 3.8): an ongoing process opens no tasks, and its owner sees it in their
// routine instead, with a check every N days ("once a week: no invoice is
// stuck"). Pure: the home screen, the client file, the daily job and the
// tests compute when a check is due the same way.

import { addDaysToKey } from "@/lib/timezone";

export const CHECK_MAX_DAYS = 365;

export type CheckState = "OVERDUE" | "DUE" | "LATER";

export const CHECK_STATE_LABELS: Record<CheckState, string> = {
  OVERDUE: "באיחור",
  DUE: "היום",
  LATER: "בהמשך",
};

/// A process is in someone's routine when it is ongoing and still alive:
/// not paused (a manager stopped it) and not retired.
export function isRoutine(p: { triggerKinds: string[]; status: string; deletedAt?: Date | null }): boolean {
  return p.triggerKinds.includes("CONTINUOUS") && (p.status === "ACTIVE" || p.status === "DRAFT") && !p.deletedAt;
}

/// The day the next check is due, as a date key, or null when the process
/// has no check. Never checked: due today, because a routine nobody has
/// looked at yet is the one most worth looking at.
export function checkDueKey(p: { checkEveryDays: number | null; lastCheckedKey: string | null }, todayKey: string): string | null {
  if (!p.checkEveryDays) return null;
  if (!p.lastCheckedKey) return todayKey;
  return addDaysToKey(p.lastCheckedKey, p.checkEveryDays);
}

export function checkState(dueKey: string, todayKey: string): CheckState {
  if (dueKey < todayKey) return "OVERDUE";
  if (dueKey === todayKey) return "DUE";
  return "LATER";
}

/// "every 7 days" in words, the way people say it.
export function checkEveryText(days: number): string {
  if (days === 1) return "כל יום";
  if (days === 7) return "פעם בשבוע";
  if (days === 14) return "פעם בשבועיים";
  if (days === 30 || days === 31) return "פעם בחודש";
  return `כל ${days} ימים`;
}

export function checkEveryError(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  if (!Number.isInteger(days) || days < 1 || days > CHECK_MAX_DAYS) return `בדיקה היא כל 1 עד ${CHECK_MAX_DAYS} ימים.`;
  return null;
}
