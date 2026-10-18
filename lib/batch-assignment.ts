// A meeting whose client is not clear (claude/org-brain-spec-2026-10-12.md,
// 5.1, step 3; decision 8). A partner who serves several of Ankora's
// clients, and nobody on the call who decides which: Claude proposes one,
// with a reason, and the batch waits until a person picks. Pure, so the
// MCP tool, the review screen and the tests say the same thing.

import { TARGET_LABELS, proposalHeadline, type ProposalTargetLike } from "@/lib/knowledge-proposals";

export const MAX_CANDIDATES = 6;

/// What is wrong with the clients Claude says it could be, or null. The
/// proposed one is among them, and there are at least two: one candidate
/// is not a question.
export function candidatesError(proposedId: string, candidateIds: string[]): string | null {
  const unique = [...new Set(candidateIds)];
  if (!unique.includes(proposedId)) return "הלקוח המוצע צריך להיות אחד המועמדים.";
  if (unique.length < 2) return "שיוך ממתין הוא בין שני לקוחות לפחות. כשברור של מי השיחה, שולחים אליו.";
  if (unique.length > MAX_CANDIDATES) return `עד ${MAX_CANDIDATES} לקוחות מועמדים.`;
  return null;
}

/// The reason is what the person deciding reads first: required, one or
/// two sentences.
export function assignmentReasonError(reason: string | null | undefined): string | null {
  const t = (reason ?? "").trim();
  if (!t) return "כותבים למה דווקא הלקוח הזה: מה בכותרת או בתוכן מצביע עליו.";
  if (t.length > 500) return "עד 500 תווים בנימוק.";
  return null;
}

type Item = { target: ProposalTargetLike; action?: string | null; targetId?: string | null; alsoSources?: string[]; payload: Record<string, unknown> };

/// The items as they go to the client a person picked. For the client
/// Claude proposed, unchanged. For another one, what pointed into the
/// proposed client's file does not travel: a change to one of its facts is
/// dropped with a reason, and its register codes are left out.
export function itemsForClient<T extends Item>(items: { index: number; item: T }[], sameAsProposed: boolean) {
  const out: T[] = [];
  const indexes: number[] = [];
  const dropped: { index: number; reason: string }[] = [];
  for (const { index, item } of items) {
    if (sameAsProposed) {
      out.push(item);
      indexes.push(index);
      continue;
    }
    if (item.action && item.action !== "CREATE") {
      dropped.push({ index, reason: "הפריט הוצע מול עובדה בתיק של לקוח אחר. אם הוא רלוונטי, שולחים אותו שוב מול התיק הזה." });
      continue;
    }
    out.push({ ...item, targetId: null, alsoSources: [] });
    indexes.push(index);
  }
  return { items: out, indexes, dropped };
}

/// One line per waiting item, enough to tell whose meeting it was. A
/// sensitive item says only that it is there.
export function waitingItemLine(target: ProposalTargetLike, payload: Record<string, unknown>): string {
  if (payload.sensitivity === "SENSITIVE") return `${TARGET_LABELS[target]}: פריט רגיש`;
  const headline = proposalHeadline(target, payload).trim();
  return `${TARGET_LABELS[target]}: ${headline.length > 140 ? `${headline.slice(0, 139)}…` : headline}`;
}
