// Auto-apply of proposals to a client file (3.11.2026, the approved
// procedure for extraction approvals, part 2). A proposal in the AUTO tier
// (lib/knowledge-proposals.ts, approvalTier) enters the file on arrival,
// with no person. What keeps that safe is here, and pure:
//
// - which auto-applied items a person still looks at after the fact
//   ("נכנס אוטומטית"): all of them in the first 14 days after auto-apply
//   was first switched on and in the 7 days after a new extraction guide
//   version was approved, and a fixed 20% sample otherwise;
// - what an error is: an auto-applied item taken out again ("ביטול"), or
//   changed, removed or replaced in the file within 30 days;
// - when a kind or a client goes back to a person: 3 errors in the last 30
//   auto-applied proposals of a kind, or 2 errors of one client within 14
//   days.

import { revertBlocker } from "@/lib/knowledge-proposals";

export const AUTO_REVIEW_ALL_DAYS = 14;
export const GUIDE_REVIEW_DAYS = 7;
/// Percent of auto-applied items a person looks at once the first days are over.
export const AUTO_REVIEW_SAMPLE_PERCENT = 20;
/// A change to the item this long after it entered counts as an error.
export const ERROR_WINDOW_DAYS = 30;
export const KIND_WINDOW = 30;
export const KIND_ERROR_LIMIT = 3;
export const CLIENT_WINDOW_DAYS = 14;
export const CLIENT_ERROR_LIMIT = 2;

/// The bar a manager checks before lifting a pause: this many new
/// decisions by a person, with this lower bound on the share approved as is.
export const LIFT_DECISIONS = 30;
export const LIFT_LOWER_BOUND = 0.85;

const DAY = 86_400_000;

/// The audit actions on an item in the file that mean the item that
/// entered on its own was not right as it was: changed, replaced by a new
/// version, contradicted, or removed. Adding a source or confirming it is
/// not an error.
export const CHANGE_ACTIONS = [
  "client_fact.supersede",
  "client_fact.contradict",
  "client_fact.remove",
  "client_contact.update",
  "client_contact.remove",
  "client_organization.update",
  "client_organization.remove",
  "client_entity.update",
  "client_entity.remove",
] as const;

/// FNV-1a, 32 bits: the same id always lands in the same bucket, on every
/// server and in every test.
export function idBucket(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/// Whether an auto-applied proposal is in the fixed sample a person looks at.
export function inAutoSample(id: string): boolean {
  return idBucket(id) < AUTO_REVIEW_SAMPLE_PERCENT;
}

/// Whether a person still looks at an auto-applied item after the fact.
/// `firstEnabledAt`: when auto-apply was first switched on (null: every
/// item is looked at). `guideApprovals`: when each extraction guide
/// version was approved.
export function needsAutoReview(
  p: { id: string; decidedAt: Date },
  ctx: { firstEnabledAt: Date | null; guideApprovals: Date[] }
): boolean {
  const at = p.decidedAt.getTime();
  if (!ctx.firstEnabledAt || at < ctx.firstEnabledAt.getTime() + AUTO_REVIEW_ALL_DAYS * DAY) return true;
  if (ctx.guideApprovals.some((g) => at >= g.getTime() && at < g.getTime() + GUIDE_REVIEW_DAYS * DAY)) return true;
  return inAutoSample(p.id);
}

/// Why a person looks at this item, in a short Hebrew line, or null.
export function autoReviewReason(
  p: { id: string; decidedAt: Date },
  ctx: { firstEnabledAt: Date | null; guideApprovals: Date[] }
): string | null {
  const at = p.decidedAt.getTime();
  if (!ctx.firstEnabledAt || at < ctx.firstEnabledAt.getTime() + AUTO_REVIEW_ALL_DAYS * DAY) return `${AUTO_REVIEW_ALL_DAYS} הימים הראשונים: בודקים כל פריט`;
  if (ctx.guideApprovals.some((g) => at >= g.getTime() && at < g.getTime() + GUIDE_REVIEW_DAYS * DAY)) return "הנחיות חילוץ חדשות: בודקים כל פריט שבוע";
  if (inAutoSample(p.id)) return `מדגם של ${AUTO_REVIEW_SAMPLE_PERCENT}%`;
  return null;
}

/// When an auto-applied item turned out wrong, or null: taken out again,
/// or changed in the file within ERROR_WINDOW_DAYS of entering.
export function autoErrorAt(p: { decidedAt: Date; revertedAt: Date | null }, changes: Date[]): Date | null {
  const until = p.decidedAt.getTime() + ERROR_WINDOW_DAYS * DAY;
  const times = [...(p.revertedAt ? [p.revertedAt.getTime()] : []), ...changes.map((d) => d.getTime()).filter((t) => t >= p.decidedAt.getTime() && t <= until)];
  return times.length ? new Date(Math.min(...times)) : null;
}

/// Whether a kind goes back to a person: of its last KIND_WINDOW
/// auto-applied proposals since `since` (the latest guide approval or the
/// latest lift of its pause), KIND_ERROR_LIMIT or more were errors.
export function kindPauseDue(rows: { decidedAt: Date; error: boolean }[], since: Date | null): { due: boolean; errors: number; counted: number } {
  const counted = rows
    .filter((r) => !since || r.decidedAt.getTime() > since.getTime())
    .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime())
    .slice(0, KIND_WINDOW);
  const errors = counted.filter((r) => r.error).length;
  return { due: errors >= KIND_ERROR_LIMIT, errors, counted: counted.length };
}

/// Whether a client goes back to a person: CLIENT_ERROR_LIMIT errors of
/// its auto-applied items within the last CLIENT_WINDOW_DAYS, counted from
/// the latest lift of its pause.
export function clientPauseDue(errorTimes: Date[], now: Date, since: Date | null): { due: boolean; errors: number } {
  const from = Math.max(now.getTime() - CLIENT_WINDOW_DAYS * DAY, since ? since.getTime() + 1 : -Infinity);
  const errors = errorTimes.filter((t) => t.getTime() >= from && t.getTime() <= now.getTime()).length;
  return { due: errors >= CLIENT_ERROR_LIMIT, errors };
}

/// The Wilson lower bound (95%) on the share approved as is, shown beside
/// "לחזור לכניסה אוטומטית" so the manager checks the bar, not a raw share.
export function wilsonLower(good: number, total: number): number {
  if (total <= 0) return 0;
  const z = 1.96;
  const p = good / total;
  const d = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return Math.max(0, (centre - margin) / d);
}

/// Whether the bar for lifting a pause is met. A human check: the button
/// works either way, this only says so beside it.
export function liftBarMet(good: number, total: number): boolean {
  return total >= LIFT_DECISIONS && wilsonLower(good, total) >= LIFT_LOWER_BOUND;
}

/// The two decisions Claude may take on an auto-applied item (3.11.2026,
/// decide_knowledge_proposals): "reviewed_ok" is the "תקין" button,
/// "revert" is "ביטול".
export type AutoAppliedDecision = "reviewed_ok" | "revert";

/// Why Claude may not take this decision on this proposal, or null.
/// "reviewed_ok" only on an item still waiting for a look (`listed`: it is
/// on "נכנס אוטומטית" now); "revert" on any auto-applied item that may still
/// be taken out (revertBlocker). Both only on what entered automatically:
/// what a person approved is taken out on its card, not from here.
export function autoDecisionBlocker(
  decision: AutoAppliedDecision,
  p: {
    autoApplied: boolean;
    autoReviewedAt: Date | string | null;
    state: string;
    action: string;
    target: string;
    attached: boolean;
    resultId: string | null;
    revertedAt: Date | string | null;
  },
  listed: boolean
): string | null {
  if (!p.autoApplied) return "This proposal did not enter the file automatically: reviewed_ok and revert are only for the items list_approvals shows under `enteredAutomatically`.";
  if (decision === "revert") {
    const why = revertBlocker(p);
    return why ? `It cannot be taken out of the file: ${why}` : null;
  }
  if (p.revertedAt) return "Its item was already taken out of the file, so there is nothing to mark.";
  if (p.autoReviewedAt) return "It was already marked right (תקין).";
  if (!listed) return "It is not waiting for a look (it is not under `enteredAutomatically`), so there is nothing to mark.";
  return null;
}
