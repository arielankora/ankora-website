// The client file's facts: their words, their sections and their rules
// (claude/org-brain-spec-2026-10-12.md, 3.4 and 6.1). Pure: no Prisma and
// no clock of its own, so a client component may import it and a test can
// pass any "now".

export type FactKindLike =
  | "SCOPE_IN"
  | "SCOPE_OUT"
  | "PREFERENCE"
  | "REQUIREMENT"
  | "LOCATION"
  | "FINANCE"
  | "TEMPORARY"
  | "ONE_OFF_DECISION"
  | "QUESTION"
  | "NOTE";

export type FactTopicLike = "COMMUNICATION" | "REPORTING" | "DOCUMENTS" | "AUTOMATION" | "ADMINS" | "PAYMENTS" | "SUPPLIERS" | "OTHER";

/// In the order of Hadas's file, with the section number a reader of the
/// file already knows.
export const FACT_SECTIONS: { kind: FactKindLike; section: string; title: string; empty: string }[] = [
  { kind: "SCOPE_IN", section: "2", title: "בתחום שלנו", empty: "עוד לא נכתב מה בתחום שלנו." },
  { kind: "SCOPE_OUT", section: "2", title: "מחוץ לתחום, ולמי מפנים", empty: "עוד לא נכתב מה מחוץ לתחום." },
  { kind: "PREFERENCE", section: "4", title: "העדפות", empty: "אין עדיין העדפות." },
  { kind: "REQUIREMENT", section: "5", title: "דרישות חוזרות", empty: "אין עדיין דרישות חוזרות." },
  { kind: "LOCATION", section: "7.3", title: "מקורות ידע ומיקומים", empty: "עוד לא נכתב איפה נמצא הידע." },
  { kind: "FINANCE", section: "8", title: "כספים", empty: "אין עדיין עובדות כספיות." },
  { kind: "TEMPORARY", section: "11", title: "מידע נוכחי או זמני", empty: "אין מידע זמני." },
  { kind: "ONE_OFF_DECISION", section: "12", title: "החלטות חד-פעמיות", empty: "אין החלטות חד-פעמיות." },
  { kind: "QUESTION", section: "13", title: "שאלות פתוחות", empty: "אין שאלות פתוחות." },
  { kind: "NOTE", section: "", title: "הערות", empty: "אין הערות." },
];

export const FACT_KIND_LABELS: Record<FactKindLike, string> = {
  SCOPE_IN: "בתחום",
  SCOPE_OUT: "מחוץ לתחום",
  PREFERENCE: "העדפה",
  REQUIREMENT: "דרישה חוזרת",
  LOCATION: "מיקום",
  FINANCE: "כספים",
  TEMPORARY: "מידע זמני",
  ONE_OFF_DECISION: "החלטה חד-פעמית",
  QUESTION: "שאלה פתוחה",
  NOTE: "הערה",
};

export const FACT_TOPIC_LABELS: Record<FactTopicLike, string> = {
  COMMUNICATION: "תקשורת",
  REPORTING: "דיווח",
  DOCUMENTS: "מסמכים",
  AUTOMATION: "אוטומציה",
  ADMINS: "אדמינים",
  PAYMENTS: "תשלומים",
  SUPPLIERS: "ספקים",
  OTHER: "אחר",
};

export type FactShape = {
  kind: FactKindLike;
  body?: string | null;
  validUntil?: Date | null;
  validUntilEvent?: string | null;
  decidedAt?: Date | null;
};

/// What each kind needs to be useful. A temporary fact without an end is
/// a permanent one nobody will ever check; a decision without a date
/// cannot be ordered against the one it replaced.
export function factShapeError(fact: FactShape): string | null {
  if (!fact.body?.trim()) return "צריך לכתוב את העובדה עצמה.";
  if (fact.kind === "TEMPORARY" && !fact.validUntil && !fact.validUntilEvent?.trim()) {
    return 'מידע זמני צריך תוקף: עד תאריך, או עד אירוע ("עד הצירוף לארגון").';
  }
  if (fact.kind === "ONE_OFF_DECISION" && !fact.decidedAt) return "החלטה חד-פעמית צריכה תאריך.";
  return null;
}

/// A question is, by definition, something not yet known. It is stored as
/// "missing", and what closes it is its answer.
export function isQuestion(kind: FactKindLike): boolean {
  return kind === "QUESTION";
}

/// A temporary fact whose date has passed and that nobody has closed yet.
/// It is not deleted, and not assumed over: the owner is asked (spec 3.4).
export function isPastValidity(fact: { kind: FactKindLike; validUntil: Date | null; closedAt: Date | null }, now: Date): boolean {
  return fact.kind === "TEMPORARY" && !fact.closedAt && fact.validUntil !== null && fact.validUntil.getTime() < now.getTime();
}

/// Days an uncertain item may wait before somebody is reminded (spec 5.4).
export const UNCERTAIN_REMINDER_DAYS = 14;
