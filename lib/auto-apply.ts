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
//   changed, removed or replaced in the file within 30 days (autoError,
//   with its type and the names of the fields that were fixed), except a
//   replacement or a contradiction that a later source brought;
// - when a kind or a client goes back to a person: 3 errors in the last 30
//   auto-applied proposals of a kind, or 2 errors of one client within 14
//   days.

import { revertBlocker } from "@/lib/knowledge-proposals";
import { proposalEditDiff } from "@/lib/proposal-edits";

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

/// autoReviewReason as a code with its numbers, for a screen that words
/// it in the reader's language (ADR 0006), or null.
export function autoReviewReasonCode(
  p: { id: string; decidedAt: Date },
  ctx: { firstEnabledAt: Date | null; guideApprovals: Date[] }
): { code: "firstDays"; days: number } | { code: "newGuide" } | { code: "sample"; percent: number } | null {
  const at = p.decidedAt.getTime();
  if (!ctx.firstEnabledAt || at < ctx.firstEnabledAt.getTime() + AUTO_REVIEW_ALL_DAYS * DAY) return { code: "firstDays", days: AUTO_REVIEW_ALL_DAYS };
  if (ctx.guideApprovals.some((g) => at >= g.getTime() && at < g.getTime() + GUIDE_REVIEW_DAYS * DAY)) return { code: "newGuide" };
  if (inAutoSample(p.id)) return { code: "sample", percent: AUTO_REVIEW_SAMPLE_PERCENT };
  return null;
}

/// What kind of error an auto-applied item turned out to be: taken out
/// again ("ביטול"), or, within ERROR_WINDOW_DAYS of entering, replaced by a
/// new version, contradicted, changed or removed in the file.
export type AutoErrorType = "REVERTED" | "SUPERSEDED" | "CONTRADICTED" | "UPDATED" | "REMOVED";
export const AUTO_ERROR_TYPES: readonly AutoErrorType[] = ["REVERTED", "SUPERSEDED", "CONTRADICTED", "UPDATED", "REMOVED"];

/// The error of one auto-applied item: what happened, when, and the names
/// of the fields that changed (never their values; empty for a revert or
/// a removal).
export type AutoError = { type: AutoErrorType; at: Date; fields: string[] };

/// Where a proposal's knowledge came from (17.11.2026): its source in the
/// register, or its batch when it has none (`key`), and the day of that
/// source (`day`, YYYY-MM-DD): the source's own date, or the day its batch
/// arrived when the source has no date.
export type ProposalSource = { key: string; day: string };

/// The day a batch arrived, in Israel: the day a person would give it.
const israelDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });

/// A proposal's source, from its batch and the batch's source in the
/// register. A source's date is stored as UTC midnight, so its UTC day is
/// the day.
export function proposalSource(batch: { id: string; createdAt: Date; sourceId: string | null }, source: { occurredAt: Date | null } | null): ProposalSource {
  const day = source?.occurredAt ? source.occurredAt.toISOString().slice(0, 10) : israelDay.format(batch.createdAt);
  return { key: batch.sourceId ? `S:${batch.sourceId}` : `B:${batch.id}`, day };
}

/// Whether a change came from a different source, of a later day, than
/// the item it changed: a later meeting or message that brought new
/// information. Not a mistake of the extraction. The same source, an
/// earlier or same-day one, or a person's own change (no source) is.
export function isNewerSource(own: ProposalSource | null | undefined, by: ProposalSource | null | undefined): boolean {
  return !!own && !!by && by.key !== own.key && by.day > own.day;
}

/// One audit row on the item in the file: its action, when, and the item
/// before and after, as recordAudit stored them. `by`: for a replacement
/// or a contradiction that came from an approved proposal, that
/// proposal's source; absent for a person's direct change on the screen.
export type ItemChange = { action: string; at: Date; before?: unknown; after?: unknown; by?: ProposalSource | null };

/// A change that is not counted as an error, and why: a replacement or a
/// contradiction from a later source (NEWER_SOURCE).
export type AutoChange = { type: "SUPERSEDED" | "CONTRADICTED"; at: Date; reason: "NEWER_SOURCE" };

const TYPE_OF: Record<(typeof CHANGE_ACTIONS)[number], AutoErrorType> = {
  "client_fact.supersede": "SUPERSEDED",
  "client_fact.contradict": "CONTRADICTED",
  "client_fact.remove": "REMOVED",
  "client_contact.update": "UPDATED",
  "client_contact.remove": "REMOVED",
  "client_organization.update": "UPDATED",
  "client_organization.remove": "REMOVED",
  "client_entity.update": "UPDATED",
  "client_entity.remove": "REMOVED",
};

/// "ביטול" takes the item out through the file's own removal, which
/// writes its own audit row a moment after the proposal is marked. That
/// row is the revert, not a second error.
export const REVERT_SLACK_MS = 60_000;

/// The row's own bookkeeping: never a field a person fixed.
const ROW_FIELDS = new Set([
  "id",
  "clientId",
  "personId",
  "organizationId",
  "createdById",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "supersededById",
  "supersededAt",
  "verifiedAt",
  "sources",
]);

/// A stored row as plain fields. A contact's person (name, emails, phones)
/// is read as the contact's own fields; any other included relation is
/// left out.
function rowFields(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (ROW_FIELDS.has(k)) continue;
    if (k === "person" && v && typeof v === "object" && !Array.isArray(v)) {
      const person = v as Record<string, unknown>;
      for (const f of ["name", "emails", "phones"]) if (f in person) out[f] = person[f];
      continue;
    }
    out[k] = v;
  }
  return out;
}

/// The names of the fields that differ between an item before and after
/// a change, by the same normalization as a proposal's edit
/// (lib/proposal-edits.ts). Only fields both rows carry are compared: a
/// relation stored on one side only (the contact's person, before
/// 14.11.2026) says nothing about a change.
export function changedFields(before: unknown, after: unknown): string[] {
  const b = rowFields(before);
  const a = rowFields(after);
  if (!b || !a) return [];
  const pick = (o: Record<string, unknown>, other: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => k in other));
  return proposalEditDiff(pick(b, a), pick(a, b)).map((d) => d.field);
}

/// The error of one auto-applied item, or null, and the changes that were
/// not counted. The single definition of an error: the pauses count
/// these, and the stats and the approvals screen explain them. The first
/// that happened counts: taken out again at any time, or a change in
/// CHANGE_ACTIONS within ERROR_WINDOW_DAYS of entering. A removal that is
/// the revert itself is not counted twice. A replacement or a
/// contradiction from a later source than the item's own (isNewerSource,
/// 17.11.2026) is new information, not an error: it is returned in
/// `notCounted`.
export function autoOutcome(
  p: { decidedAt: Date; revertedAt: Date | null; source?: ProposalSource | null },
  changes: ItemChange[]
): { error: AutoError | null; notCounted: AutoChange[] } {
  const from = p.decidedAt.getTime();
  const until = from + ERROR_WINDOW_DAYS * DAY;
  const found: AutoError[] = p.revertedAt ? [{ type: "REVERTED", at: p.revertedAt, fields: [] }] : [];
  const notCounted: AutoChange[] = [];
  for (const c of changes) {
    const type = TYPE_OF[c.action as keyof typeof TYPE_OF];
    if (!type) continue;
    const t = c.at.getTime();
    if (t < from || t > until) continue;
    if (type === "REMOVED" && p.revertedAt && t >= p.revertedAt.getTime() - REVERT_SLACK_MS) continue;
    if ((type === "SUPERSEDED" || type === "CONTRADICTED") && isNewerSource(p.source, c.by)) {
      notCounted.push({ type, at: c.at, reason: "NEWER_SOURCE" });
      continue;
    }
    found.push({ type, at: c.at, fields: type === "REMOVED" ? [] : changedFields(c.before, c.after) });
  }
  notCounted.sort((x, y) => x.at.getTime() - y.at.getTime());
  if (found.length === 0) return { error: null, notCounted };
  // Earliest first; at the same moment a revert says the most.
  const error = found.sort((x, y) => x.at.getTime() - y.at.getTime() || (x.type === "REVERTED" ? -1 : y.type === "REVERTED" ? 1 : 0))[0];
  return { error, notCounted };
}

/// autoOutcome, the error only.
export function autoError(p: { decidedAt: Date; revertedAt: Date | null; source?: ProposalSource | null }, changes: ItemChange[]): AutoError | null {
  return autoOutcome(p, changes).error;
}

/// The errors behind a pause, for the manager who decides to lift it:
/// how many of each type, and per type and over all, which fields were
/// fixed, most often first. Names and counts only.
export type AutoErrorSummary = {
  errors: number;
  byType: Partial<Record<AutoErrorType, number>>;
  topFields: { field: string; count: number }[];
  types: { type: AutoErrorType; count: number; fields: { field: string; count: number }[] }[];
};

export const TOP_FIELDS = 5;

function countFields(errors: { fields: string[] }[]): { field: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of errors) for (const f of new Set(e.fields)) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count || a.field.localeCompare(b.field)).slice(0, TOP_FIELDS);
}

export function summarizeAutoErrors(errors: { type: AutoErrorType; fields: string[] }[]): AutoErrorSummary {
  const types = AUTO_ERROR_TYPES.flatMap((type) => {
    const of = errors.filter((e) => e.type === type);
    return of.length ? [{ type, count: of.length, fields: countFields(of) }] : [];
  });
  return {
    errors: errors.length,
    byType: Object.fromEntries(types.map((t) => [t.type, t.count])),
    topFields: countFields(errors),
    types,
  };
}

/// The auto-applied proposals of a kind that its rule counts: its last
/// KIND_WINDOW, decided after `since`, newest first.
export function kindWindow<T extends { decidedAt: Date }>(rows: T[], since: Date | null): T[] {
  return rows
    .filter((r) => !since || r.decidedAt.getTime() > since.getTime())
    .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime())
    .slice(0, KIND_WINDOW);
}

/// The errors of a client its rule counts at `now`: within the last
/// CLIENT_WINDOW_DAYS, after the latest lift of its pause.
export function clientWindow<T extends { at: Date }>(errors: T[], now: Date, since: Date | null): T[] {
  const from = Math.max(now.getTime() - CLIENT_WINDOW_DAYS * DAY, since ? since.getTime() + 1 : -Infinity);
  return errors.filter((e) => e.at.getTime() >= from && e.at.getTime() <= now.getTime());
}

/// Whether a kind goes back to a person: of its last KIND_WINDOW
/// auto-applied proposals since `since` (the latest guide approval or the
/// latest lift of its pause), KIND_ERROR_LIMIT or more were errors.
export function kindPauseDue(rows: { decidedAt: Date; error: boolean }[], since: Date | null): { due: boolean; errors: number; counted: number } {
  const counted = kindWindow(rows, since);
  const errors = counted.filter((r) => r.error).length;
  return { due: errors >= KIND_ERROR_LIMIT, errors, counted: counted.length };
}

/// Whether a client goes back to a person: CLIENT_ERROR_LIMIT errors of
/// its auto-applied items within the last CLIENT_WINDOW_DAYS, counted from
/// the latest lift of its pause.
export function clientPauseDue(errorTimes: Date[], now: Date, since: Date | null): { due: boolean; errors: number } {
  const errors = clientWindow(errorTimes.map((at) => ({ at })), now, since).length;
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

/// Fields named beside each type of error in a pause's line, at most.
export const PAUSE_FIELDS_PER_TYPE = 3;

/// "3 טעויות: 2 עריכות (תפקיד, אימייל), 1 מחיקה": what the errors that
/// caused a pause were, in one line, worded by the caller's dictionary
/// (knowledge.auto). The screen and list_approvals word it the same way.
/// A field with no label keeps its name. Null when there were none.
export function pauseErrorsLine(
  words: { type: (type: AutoErrorType, count: number) => string; field: (field: string) => string | null; line: (count: number, parts: string) => string },
  types: { type: AutoErrorType; count: number; fields: string[] }[]
): string | null {
  if (types.length === 0) return null;
  const parts = types.map((e) => {
    const fields = e.fields.slice(0, PAUSE_FIELDS_PER_TYPE).map((f) => words.field(f) ?? f);
    const what = words.type(e.type, e.count);
    return fields.length ? `${what} (${fields.join(", ")})` : what;
  });
  return words.line(
    types.reduce((n, e) => n + e.count, 0),
    parts.join(", ")
  );
}
