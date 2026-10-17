// When a process needs a person to look at it again
// (claude/org-brain-spec-2026-10-12.md, 5.4 and 7.3). Pure, so the card,
// the file, the job and the tests agree.

export type ReviewReason = "RULES" | "PERIODIC";

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  RULES: "הנוהל שבתוקף לא עומד בכללי הלקוח",
  PERIODIC: "הגיע מועד הסקירה התקופתית",
};

export const MAX_REVIEW_EVERY_DAYS = 730;

export function reviewEveryError(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  if (!Number.isInteger(days) || days < 1 || days > MAX_REVIEW_EVERY_DAYS) return `סקירה היא כל מספר שלם של ימים, עד ${MAX_REVIEW_EVERY_DAYS}.`;
  return null;
}

const DAY = 24 * 60 * 60 * 1000;

/// The day the next review falls due: `reviewEveryDays` after the last
/// one, or after the procedure was first approved. Null without a period
/// or before anything was approved.
export function reviewDueAt(p: { reviewEveryDays: number | null; lastReviewedAt: Date | null }): Date | null {
  if (!p.reviewEveryDays || !p.lastReviewedAt) return null;
  return new Date(p.lastReviewedAt.getTime() + p.reviewEveryDays * DAY);
}

export function isReviewDue(p: { reviewEveryDays: number | null; lastReviewedAt: Date | null }, now: Date): boolean {
  const due = reviewDueAt(p);
  return !!due && due.getTime() <= now.getTime();
}

export function readReviewReason(v: string | null | undefined): ReviewReason | null {
  return v === "RULES" || v === "PERIODIC" ? v : null;
}

/// One line saying what changed, for a run's comment and a notification.
/// A rule not meant for everyone on the client is not named.
export function ruleChangeCause(rule: { title: string; audience: string }, what: string): string {
  return rule.audience === "ALL_STAFF" ? `${what}: "${rule.title}"` : `${what} (כלל שמוגבל לצפייה)`;
}
