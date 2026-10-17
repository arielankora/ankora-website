// The one line at the top of a client's file (claude/org-brain-spec-2026-
// 10-12.md, 7.6): where the handover stands and what needs a person, in
// numbers. Pure, so the client screen, the file, the Markdown and the tests
// say the same thing.

import { addDaysToKey, isBusinessDay, type BusinessCalendarKey } from "@/lib/business-calendar";
import { effectiveStatus, parseFieldStatus, type KnowledgeStatusLike } from "@/lib/knowledge";

/// After this many business days without a batch from the extraction, the
/// account manager hears about it (mapping gap 17): "updated every day at
/// 12:00" with no way to tell it stopped is what this replaces.
export const STALE_BUSINESS_DAYS = 3;

export type ControlData = {
  processes: number;
  withAnkora: number;
  inHandover: number;
  /// Mean of the nine-field scores, one decimal; null with no processes.
  avgCompleteness: number | null;
  needsReview: number;
  noBackup: number;
  exceptionsInForce: number;
  exceptionsRequested: number;
  uncertain: number;
  openQuestions: number;
  systemsWithoutAccess: number;
  /// Business days since the last batch of proposals; null when there was
  /// never one.
  daysSinceBatch: number | null;
};

export type ControlPart = { text: string; warn: boolean };

/// Business days after `fromKey` up to and including `toKey`. Same day: 0.
export function businessDaysBetween(fromKey: string, toKey: string, calendar: BusinessCalendarKey = "IL"): number {
  if (toKey <= fromKey) return 0;
  let n = 0;
  let cursor = fromKey;
  for (let guard = 0; cursor < toKey && guard < 3660; guard++) {
    cursor = addDaysToKey(cursor, 1);
    if (isBusinessDay(cursor, calendar)) n++;
  }
  return n;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/// The parts of the line, in the spec's order. A count of zero is left
/// out, except where zero is itself the news (no processes yet).
export function controlParts(d: ControlData): ControlPart[] {
  const parts: ControlPart[] = [];
  if (d.processes === 0) {
    parts.push({ text: "אין עדיין תהליכים", warn: false });
  } else {
    const where = [d.withAnkora ? `${d.withAnkora} אצלנו` : null, d.inHandover ? `${d.inHandover} בחפיפה` : null].filter(Boolean).join(" ו-");
    parts.push({ text: `${plural(d.processes, "תהליך אחד", "תהליכים")}${where ? `, ${where}` : ""}`, warn: false });
    if (d.avgCompleteness !== null) parts.push({ text: `שלמות ממוצעת ${d.avgCompleteness} מתוך 9`, warn: d.avgCompleteness < 8 });
  }
  if (d.needsReview) parts.push({ text: d.needsReview === 1 ? "תהליך אחד דורש סקירה" : `${d.needsReview} תהליכים דורשים סקירה`, warn: true });
  if (d.noBackup) parts.push({ text: `${plural(d.noBackup, "תהליך אחד", "תהליכים")} בלי מחליף`, warn: true });
  if (d.exceptionsInForce) parts.push({ text: `${plural(d.exceptionsInForce, "חריגה אחת", "חריגות")} בתוקף`, warn: false });
  if (d.exceptionsRequested) parts.push({ text: d.exceptionsRequested === 1 ? "בקשת חריגה אחת ממתינה" : `${d.exceptionsRequested} בקשות חריגה ממתינות`, warn: true });
  if (d.uncertain) parts.push({ text: d.uncertain === 1 ? "פריט אחד לא ודאי" : `${d.uncertain} פריטים לא ודאיים`, warn: false });
  if (d.openQuestions) parts.push({ text: `${plural(d.openQuestions, "שאלה פתוחה אחת", "שאלות פתוחות")}`, warn: false });
  if (d.systemsWithoutAccess) parts.push({ text: `${plural(d.systemsWithoutAccess, "מערכת אחת", "מערכות")} בלי גישה`, warn: true });
  parts.push(
    d.daysSinceBatch === null
      ? { text: "עוד לא הגיעה אצווה מהחילוץ", warn: false }
      : {
          text: `אצווה אחרונה: ${d.daysSinceBatch === 0 ? "היום" : d.daysSinceBatch === 1 ? "לפני יום עבודה" : `לפני ${d.daysSinceBatch} ימי עבודה`}`,
          warn: d.daysSinceBatch > STALE_BUSINESS_DAYS,
        }
  );
  return parts;
}

export function controlLine(d: ControlData): string {
  return controlParts(d)
    .map((p) => p.text)
    .join(" · ");
}

type Item = { knowledgeStatus: KnowledgeStatusLike; fieldStatus: unknown };

/// Items not confirmed, weakest field first (rule 1), across the file.
export function countUncertain(items: Item[]): number {
  return items.filter((i) => {
    const s = effectiveStatus(i.knowledgeStatus, parseFieldStatus(i.fieldStatus));
    return s === "UNCERTAIN" || s === "MISSING";
  }).length;
}

/// The numbers from what the screens already load: the same rows, so the
/// line never counts what this person cannot see.
export function controlFrom(input: {
  processes: { transitionStatus: string; completeness: { score: number }; needsReview: boolean; backupOwnerId: string | null; status: string }[];
  exceptions: { status: string }[];
  facts: (Item & { kind: string; answeredAt: Date | null; closedAt: Date | null })[];
  otherItems: Item[];
  systems: { accessStatus: string }[];
  daysSinceBatch: number | null;
}): ControlData {
  const live = input.processes.filter((p) => p.status !== "RETIRED");
  return {
    processes: live.length,
    withAnkora: live.filter((p) => p.transitionStatus === "WITH_ANKORA").length,
    inHandover: live.filter((p) => p.transitionStatus === "IN_HANDOVER").length,
    avgCompleteness: live.length ? Math.round((live.reduce((a, p) => a + p.completeness.score, 0) / live.length) * 10) / 10 : null,
    needsReview: live.filter((p) => p.needsReview).length,
    noBackup: live.filter((p) => !p.backupOwnerId).length,
    exceptionsInForce: input.exceptions.filter((e) => e.status === "APPROVED").length,
    exceptionsRequested: input.exceptions.filter((e) => e.status === "REQUESTED").length,
    // A question is its own count; an answered or closed fact is history.
    uncertain: countUncertain([...input.facts.filter((f) => f.kind !== "QUESTION" && !f.closedAt), ...input.otherItems]),
    openQuestions: input.facts.filter((f) => f.kind === "QUESTION" && !f.answeredAt).length,
    systemsWithoutAccess: input.systems.filter((s) => s.accessStatus === "NO_ACCESS" || s.accessStatus === "PENDING").length,
    daysSinceBatch: input.daysSinceBatch,
  };
}
