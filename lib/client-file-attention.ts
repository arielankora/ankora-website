// What in a client's file needs somebody's attention, and how to say it
// (claude/org-brain-spec-2026-10-12.md, 3.4 and 5.4). Pure: the daily job
// gathers the rows, this counts them and writes the sentence.
//
// Three things go stale without anybody noticing, and the file says so
// once a week instead of never:
//
// - temporary information whose date has passed ("still true?"),
// - uncertain items nobody has confirmed for two weeks,
// - open questions nobody has answered.

import { UNCERTAIN_REMINDER_DAYS } from "@/lib/client-facts";

export type Attention = {
  pastValidity: number;
  staleUncertain: number;
  openQuestions: number;
};

export const DAY_MS = 24 * 60 * 60 * 1000;

/// How often the same person hears about the same client, unless
/// something new has expired since.
export const ATTENTION_EVERY_DAYS = 7;

export function isStaleUncertain(item: { knowledgeStatus: string; updatedAt: Date }, now: Date): boolean {
  return item.knowledgeStatus === "UNCERTAIN" && now.getTime() - item.updatedAt.getTime() > UNCERTAIN_REMINDER_DAYS * DAY_MS;
}

export function hasAttention(a: Attention): boolean {
  return a.pastValidity + a.staleUncertain + a.openQuestions > 0;
}

/// One sentence, the counts that are not zero, in order of urgency.
export function attentionSentence(a: Attention): string {
  const parts: string[] = [];
  if (a.pastValidity) parts.push(a.pastValidity === 1 ? "פריט זמני אחד עבר את התוקף שלו. עדיין נכון?" : `${a.pastValidity} פריטים זמניים עברו את התוקף שלהם. עדיין נכונים?`);
  if (a.openQuestions) parts.push(a.openQuestions === 1 ? "שאלה פתוחה אחת עדיין בלי תשובה." : `${a.openQuestions} שאלות פתוחות עדיין בלי תשובה.`);
  if (a.staleUncertain) {
    parts.push(
      a.staleUncertain === 1
        ? `פריט אחד לא ודאי כבר יותר מ-${UNCERTAIN_REMINDER_DAYS} יום.`
        : `${a.staleUncertain} פריטים לא ודאיים כבר יותר מ-${UNCERTAIN_REMINDER_DAYS} יום.`
    );
  }
  return parts.join(" ");
}
