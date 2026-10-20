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
  /// Spec 3.1: items the client may see in the portal, and items nobody at
  /// Ankora keeps.
  clientVisible: number;
  noOwner: number;
  /// Business days since the last batch of proposals; null when there was
  /// never one.
  daysSinceBatch: number | null;
};

/// `key` names what is behind the count (controlDetails), when something is.
export type ControlPart = { text: string; warn: boolean; key?: ControlKey };

export type ControlKey = "processes" | "completeness" | "needsReview" | "noBackup" | "exceptionsInForce" | "exceptionsRequested" | "uncertain" | "openQuestions" | "clientVisible" | "noOwner" | "systemsWithoutAccess";

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
    parts.push({ text: `${plural(d.processes, "תהליך אחד", "תהליכים")}${where ? `, ${where}` : ""}`, warn: false, key: "processes" });
    if (d.avgCompleteness !== null) parts.push({ text: `שלמות ממוצעת ${d.avgCompleteness} מתוך 9`, warn: d.avgCompleteness < 8, key: "completeness" });
  }
  if (d.needsReview) parts.push({ text: d.needsReview === 1 ? "תהליך אחד דורש סקירה" : `${d.needsReview} תהליכים דורשים סקירה`, warn: true, key: "needsReview" });
  if (d.noBackup) parts.push({ text: `${plural(d.noBackup, "תהליך אחד", "תהליכים")} בלי מחליף`, warn: true, key: "noBackup" });
  if (d.exceptionsInForce) parts.push({ text: `${plural(d.exceptionsInForce, "חריגה אחת", "חריגות")} בתוקף`, warn: false, key: "exceptionsInForce" });
  if (d.exceptionsRequested) parts.push({ text: d.exceptionsRequested === 1 ? "בקשת חריגה אחת ממתינה" : `${d.exceptionsRequested} בקשות חריגה ממתינות`, warn: true, key: "exceptionsRequested" });
  if (d.uncertain) parts.push({ text: d.uncertain === 1 ? "פריט אחד לא ודאי" : `${d.uncertain} פריטים לא ודאיים`, warn: false, key: "uncertain" });
  if (d.openQuestions) parts.push({ text: `${plural(d.openQuestions, "שאלה פתוחה אחת", "שאלות פתוחות")}`, warn: false, key: "openQuestions" });
  if (d.clientVisible) parts.push({ text: d.clientVisible === 1 ? "פריט אחד גלוי ללקוח" : `${d.clientVisible} פריטים גלויים ללקוח`, warn: false, key: "clientVisible" });
  if (d.noOwner) parts.push({ text: `${plural(d.noOwner, "פריט אחד", "פריטים")} בלי בעלים`, warn: false, key: "noOwner" });
  if (d.systemsWithoutAccess) parts.push({ text: `${plural(d.systemsWithoutAccess, "מערכת אחת", "מערכות")} בלי גישה`, warn: true, key: "systemsWithoutAccess" });
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

type Item = { knowledgeStatus: KnowledgeStatusLike; fieldStatus: unknown; clientVisible?: boolean; ownerId?: string | null };

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
  processes: { transitionStatus: string; completeness: { score: number }; needsReview: boolean; backupOwnerId: string | null; status: string; clientVisible?: boolean }[];
  exceptions: { status: string }[];
  facts: (Item & { kind: string; answeredAt: Date | null; closedAt: Date | null })[];
  otherItems: Item[];
  systems: { accessStatus: string }[];
  daysSinceBatch: number | null;
}): ControlData {
  const live = input.processes.filter((p) => p.status !== "RETIRED");
  // The items of the file, as they stand now: not a question, not history.
  const items = [...input.facts.filter((f) => f.kind !== "QUESTION" && !f.closedAt), ...input.otherItems];
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
    uncertain: countUncertain(items),
    openQuestions: input.facts.filter((f) => f.kind === "QUESTION" && !f.answeredAt).length,
    clientVisible: live.filter((p) => p.clientVisible).length + items.filter((i) => i.clientVisible).length,
    noOwner: items.filter((i) => !i.ownerId).length,
    systemsWithoutAccess: input.systems.filter((s) => s.accessStatus === "NO_ACCESS" || s.accessStatus === "PENDING").length,
    daysSinceBatch: input.daysSinceBatch,
  };
}

// ---------------------------------------------------------------------------
// What is behind each count (spec 7.6): the same rows, by name, so a person
// who reads "3 processes need review" can see which without opening every
// section.
// ---------------------------------------------------------------------------

/// The most names shown behind one count. The section has the rest.
export const CONTROL_DETAIL_LIMIT = 30;

export type DetailInput = {
  processes: { id?: string; code: string; title: string; transitionStatus: string; completeness: { score: number }; needsReview: boolean; reviewLabel?: string | null; backupOwnerId: string | null; status: string; clientVisible?: boolean }[];
  exceptions: { status: string; what: string; ruleTitle?: string | null; policyId?: string | null }[];
  facts: (Item & { id?: string; kind: string; body: string; answeredAt: Date | null; closedAt: Date | null; toResolve?: string | null })[];
  otherItems: (Item & { id?: string; label: string; toResolve?: string | null })[];
  systems: { id?: string; systemName: string; accessStatus: string }[];
};

/// One name behind a count, and where it lives in the file, so a click
/// opens the item itself, where it is understood and fixed (Ariel,
/// 20.10.2026: the list was only text). `note` says why it is listed,
/// when the name alone does not.
export type ControlDetail = { text: string; id?: string; note?: string };

const ACCESS_NOTE: Record<string, string> = { NO_ACCESS: "אין גישה", PENDING: "הגישה ממתינה" };

export function controlDetails(input: DetailInput): Partial<Record<ControlKey, ControlDetail[]>> {
  const live = input.processes.filter((p) => p.status !== "RETIRED");
  const name = (p: { code: string; title: string }) => `${p.code} ${p.title}`;
  const proc = (p: (typeof live)[number], note?: string): ControlDetail => ({ text: name(p), id: p.id, ...(note ? { note } : {}) });
  const facts = input.facts.filter((f) => f.kind !== "QUESTION" && !f.closedAt).map((f) => ({ ...f, label: f.body }));
  const items = [...facts, ...input.otherItems];
  const item = (i: (typeof items)[number], note?: string | null): ControlDetail => ({ text: i.label, id: i.id, ...(note?.trim() ? { note: note.trim() } : {}) });
  const uncertain = (i: Item) => {
    const s = effectiveStatus(i.knowledgeStatus, parseFieldStatus(i.fieldStatus));
    return s === "UNCERTAIN" || s === "MISSING";
  };
  const cap = (xs: ControlDetail[]) => (xs.length > CONTROL_DETAIL_LIMIT ? [...xs.slice(0, CONTROL_DETAIL_LIMIT), { text: `ועוד ${xs.length - CONTROL_DETAIL_LIMIT}` }] : xs);
  const exception = (e: DetailInput["exceptions"][number]): ControlDetail => ({ text: e.ruleTitle ? `${e.ruleTitle}: ${e.what}` : e.what, id: e.policyId ?? undefined });
  const out: Partial<Record<ControlKey, ControlDetail[]>> = {
    processes: live.map((p) => proc(p)),
    completeness: live.filter((p) => p.completeness.score < 9).sort((a, b) => a.completeness.score - b.completeness.score).map((p) => proc(p, `${p.completeness.score} מתוך 9`)),
    needsReview: live.filter((p) => p.needsReview).map((p) => proc(p, p.reviewLabel ?? undefined)),
    noBackup: live.filter((p) => !p.backupOwnerId).map((p) => proc(p)),
    exceptionsInForce: input.exceptions.filter((e) => e.status === "APPROVED").map(exception),
    exceptionsRequested: input.exceptions.filter((e) => e.status === "REQUESTED").map(exception),
    uncertain: items.filter(uncertain).map((i) => item(i, i.toResolve)),
    openQuestions: input.facts.filter((f) => f.kind === "QUESTION" && !f.answeredAt).map((f) => ({ text: f.body, id: f.id })),
    clientVisible: [...live.filter((p) => p.clientVisible).map((p) => proc(p)), ...items.filter((i) => i.clientVisible).map((i) => item(i))],
    noOwner: items.filter((i) => !i.ownerId).map((i) => item(i)),
    systemsWithoutAccess: input.systems.filter((s) => s.accessStatus === "NO_ACCESS" || s.accessStatus === "PENDING").map((s) => ({ text: s.systemName, id: s.id, note: ACCESS_NOTE[s.accessStatus] })),
  };
  const short = (x: string) => (x.length > 140 ? `${x.slice(0, 139)}…` : x);
  for (const k of Object.keys(out) as ControlKey[]) out[k] = cap(out[k]!.map((d) => ({ ...d, text: short(d.text), ...(d.note ? { note: short(d.note) } : {}) })));
  return out;
}
