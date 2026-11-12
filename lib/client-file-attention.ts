// What in a client's file needs somebody's attention, and how to say it
// (claude/org-brain-spec-2026-10-12.md, 3.4 and 5.4). Pure: the daily job
// gathers the rows, this counts them and writes the sentence.
//
// Three things go stale without anybody noticing, and the file says so
// once a week instead of never:
//
// - temporary information whose date has passed ("still true?"),
// - uncertain items nobody has confirmed for two weeks,
// - open questions nobody has answered,
// - a client's rule proposed and not approved for three days: it does not
//   bind until a manager approves it, so the managers who approve it hear,
// - proposals waiting on the review screen for more than a week
//   (20.10.2026): a procedure proposed and never approved is no more in
//   the file than one never proposed.

import { UNCERTAIN_REMINDER_DAYS } from "@/lib/client-facts";
import type { OutgoingT } from "@/lib/i18n/outgoing";

export type Attention = {
  pastValidity: number;
  staleUncertain: number;
  openQuestions: number;
  /// Rules proposed more than two weeks ago and still not approved.
  staleProposedRules: number;
  /// Rules whose review date has passed (spec 3.11).
  rulesDueReview?: number;
  /// Proposals still waiting on the review screen after a week.
  staleProposals?: number;
};

export const DAY_MS = 24 * 60 * 60 * 1000;

/// How often the same person hears about the same client, unless
/// something new has expired since.
export const ATTENTION_EVERY_DAYS = 7;

/// How long a proposal may wait on the review screen before the file says
/// so (Ariel, 20.10.2026: a week).
export const PROPOSAL_WAIT_DAYS = 7;

export function isStaleProposal(p: { state: string; createdAt: Date }, now: Date): boolean {
  return p.state === "PENDING" && now.getTime() - p.createdAt.getTime() > PROPOSAL_WAIT_DAYS * DAY_MS;
}

export function isStaleUncertain(item: { knowledgeStatus: string; updatedAt: Date }, now: Date): boolean {
  return item.knowledgeStatus === "UNCERTAIN" && now.getTime() - item.updatedAt.getTime() > UNCERTAIN_REMINDER_DAYS * DAY_MS;
}

export function hasAttention(a: Attention): boolean {
  return a.pastValidity + a.staleUncertain + a.openQuestions + a.staleProposedRules + (a.rulesDueReview ?? 0) + (a.staleProposals ?? 0) > 0;
}

/// One sentence, the counts that are not zero, in order of urgency.
///
/// Written to a person (the weekly notification, the morning digest), so
/// in that person's language (ADR 0006, outgoing channels): the caller
/// passes the recipient's words from lib/i18n/outgoing.ts. A type-only
/// import, so this module stays free of the dictionaries.
export function attentionSentence(a: Attention, t: OutgoingT): string {
  const parts: string[] = [];
  if (a.pastValidity) parts.push(t("attention.pastValidity", { count: a.pastValidity }));
  if (a.openQuestions) parts.push(t("attention.openQuestions", { count: a.openQuestions }));
  if (a.staleUncertain) parts.push(t("attention.staleUncertain", { count: a.staleUncertain, days: String(UNCERTAIN_REMINDER_DAYS) }));
  if (a.staleProposedRules) parts.push(t("attention.staleProposedRules", { count: a.staleProposedRules, days: String(RULE_WAIT_DAYS) }));
  if (a.staleProposals) parts.push(t("attention.staleProposals", { count: a.staleProposals, days: String(PROPOSAL_WAIT_DAYS) }));
  if (a.rulesDueReview) parts.push(t("attention.rulesDueReview", { count: a.rulesDueReview }));
  return parts.join(" ");
}

/// A rule proposed more than two weeks ago (spec 7.1): the client said
/// something binding, and Ankora still works by the careful interim rule.
/// How long a client's rule may wait for a manager before the managers
/// who approve it hear again (Ariel, 20.10.2026: three days; it was two
/// weeks, and only the account manager heard, who cannot approve it).
export const RULE_WAIT_DAYS = 3;

export function isStaleProposedRule(rule: { status: string; createdAt: Date }, now: Date): boolean {
  return rule.status === "PROPOSED" && now.getTime() - rule.createdAt.getTime() > RULE_WAIT_DAYS * DAY_MS;
}
