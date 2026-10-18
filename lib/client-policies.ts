// The client's own rules: their words, and what applies right now
// (claude/org-brain-spec-2026-10-12.md, 3.11). Pure: no Prisma, so the
// screen, the file, the prompt and the tests share one reading of a rule.
//
// Three layers, as in the spec: Ankora's mandatory rules (the SOP book, in
// code), the client's rules (here), Ankora's defaults (in code). This
// module is the middle one.

export type PolicyKindLike =
  | "DATA_HANDLING"
  | "DISCLOSURE"
  | "COMMUNICATION"
  | "SEPARATION"
  | "APPROVAL_REQUIRED"
  | "THRESHOLD"
  | "REQUIRED_STEP"
  | "TIMING"
  | "FORBIDDEN"
  | "INFO";

export type PolicyStatusLike = "PROPOSED" | "ACTIVE" | "RETIRED";

export const POLICY_KINDS: PolicyKindLike[] = [
  "DATA_HANDLING",
  "DISCLOSURE",
  "COMMUNICATION",
  "SEPARATION",
  "APPROVAL_REQUIRED",
  "THRESHOLD",
  "REQUIRED_STEP",
  "TIMING",
  "FORBIDDEN",
  "INFO",
];

export const POLICY_KIND_LABELS: Record<PolicyKindLike, string> = {
  DATA_HANDLING: "טיפול במידע",
  DISCLOSURE: "חשיפה",
  COMMUNICATION: "תקשורת",
  SEPARATION: "הפרדה",
  APPROVAL_REQUIRED: "אישור נדרש",
  THRESHOLD: "סף",
  REQUIRED_STEP: "שלב חובה",
  TIMING: "תזמון",
  FORBIDDEN: "איסור",
  INFO: "כלל עבודה",
};

/// One line under the kind in the form: what the rule does in the product
/// today, so nobody expects a check that does not exist yet.
export const POLICY_KIND_HINTS: Record<PolicyKindLike, string> = {
  DATA_HANDLING: "מה נכנס לתיק ואיך. נשלח לכל חילוץ, ידני ויומי.",
  DISCLOSURE: "למי אסור לספר מה. מוצג בראש מסך הלקוח ובראש התיק.",
  COMMUNICATION: "באיזה ערוץ עושים מה, ולאן מגיעות חשבוניות. עם ערוצים, נבדק מול שלבי נוהל (דורש חריגה). עם כתובות, נבדק מול מפת המערכות.",
  SEPARATION: "מה נשאר מופרד בין ישויות. נבדק מול שלבי נוהל (דורש חריגה) וסוגי פניות.",
  APPROVAL_REQUIRED: "מה דורש אישור. עם פעולות, נוהל בלי שלב אישור לא מאושר.",
  THRESHOLD: "סכום שמעליו צריך אישור. עם סכום, שלב מעליו בלי אישור חוסם את הנוהל.",
  REQUIRED_STEP: "שלב שחייב להיות. עם ניסוח, נבדק מול שלבי נוהל (דורש חריגה).",
  TIMING: "כמה זמן לפני. עם ימי עסקים, נבדק מול שלבי נוהל (דורש חריגה).",
  FORBIDDEN: "מה אסור לכולם, לא רק ל-AI. עם פעולות, שלב כזה בנוהל דורש חריגה.",
  INFO: "כל השאר: נקרא על ידי אנשים ועל ידי Claude.",
};

export const POLICY_STATUS_LABELS: Record<PolicyStatusLike, string> = {
  PROPOSED: "מוצע",
  ACTIVE: "בתוקף",
  RETIRED: "בוטל",
};

/// Kinds that can permit something ("software up to $3,000 is
/// approved"). Until such a rule is approved, a careful interim rule has
/// to say what applies, or the unapproved permission would apply by
/// default.
export const NEEDS_INTERIM: PolicyKindLike[] = ["THRESHOLD", "APPROVAL_REQUIRED"];

export type PolicyShape = {
  kind: PolicyKindLike;
  status: PolicyStatusLike;
  title?: string | null;
  statement?: string | null;
  interimStatement?: string | null;
};

export function policyShapeError(p: PolicyShape): string | null {
  if (!p.title?.trim()) return "צריך שם לכלל.";
  if (!p.statement?.trim()) return "צריך לכתוב את הכלל עצמו.";
  if (p.status === "PROPOSED" && NEEDS_INTERIM.includes(p.kind) && !p.interimStatement?.trim()) {
    return 'כלל מוצע מסוג זה צריך כלל ביניים: מה עושים עד שהוא מאושר ("כל הוצאה עוברת לאורן").';
  }
  return null;
}

/// What applies now. An approved rule applies as written. A proposed one
/// applies through its interim rule when it has one; without one, as
/// written, because a restriction the client asked for is followed before
/// anyone approves it. A retired rule applies to nothing.
export function ruleInForce(
  p: { status: PolicyStatusLike; statement: string; interimStatement: string | null; effectiveFrom?: Date | null },
  now: Date = new Date()
): { text: string; interim: boolean; startsOn?: Date } | null {
  if (p.status === "RETIRED") return null;
  if (p.status === "PROPOSED" && p.interimStatement?.trim()) return { text: p.interimStatement.trim(), interim: true };
  // Spec 3.11: a rule that starts on a date says so, and binds nothing
  // before it.
  if (p.effectiveFrom && p.effectiveFrom.getTime() > now.getTime()) return { text: p.statement.trim(), interim: false, startsOn: p.effectiveFrom };
  return { text: p.statement.trim(), interim: false };
}

/// Spec 3.11: whether a rule binds today. A rule that starts later is
/// read, and checked against nothing yet.
export function ruleBindsNow(p: { status: PolicyStatusLike; statement: string; interimStatement: string | null; effectiveFrom?: Date | null }, now: Date = new Date()): boolean {
  const r = ruleInForce(p, now);
  return !!r && !r.startsOn;
}

/// Spec 3.11: a rule whose review date has passed, until someone reviews
/// it and sets the next one.
export function ruleReviewDue(p: { status: PolicyStatusLike; reviewBy?: Date | null }, now: Date = new Date()): boolean {
  return p.status !== "RETIRED" && !!p.reviewBy && p.reviewBy.getTime() <= now.getTime();
}

const dayLabel = (d: Date) => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(d);

/// The two dates as people read them, for the panel, the file and Claude.
export function ruleDatesLine(p: { status: PolicyStatusLike; effectiveFrom?: Date | null; reviewBy?: Date | null }, now: Date = new Date()): string | null {
  const parts: string[] = [];
  if (p.effectiveFrom) parts.push(p.effectiveFrom.getTime() > now.getTime() ? `נכנס לתוקף ב-${dayLabel(p.effectiveFrom)}` : `בתוקף מ-${dayLabel(p.effectiveFrom)}`);
  if (p.reviewBy) parts.push(ruleReviewDue(p, now) ? `מועד הסקירה עבר (${dayLabel(p.reviewBy)})` : `לסקירה עד ${dayLabel(p.reviewBy)}`);
  return parts.length ? parts.join(" · ") : null;
}

/// The rule as one line for a reader who has nothing else: Claude in an
/// extraction prompt, or the file's section 6.
export function ruleLine(p: { title: string; status: PolicyStatusLike; statement: string; interimStatement: string | null; effectiveFrom?: Date | null }): string | null {
  const now = ruleInForce(p);
  if (!now) return null;
  if (now.interim) return `${p.title}: עד שהכלל יאושר, ${now.text} (הכלל המוצע: ${p.statement.trim()})`;
  if (now.startsOn) return `${p.title}: מ-${dayLabel(now.startsOn)}, ${now.text}${p.status === "PROPOSED" ? " (מוצע, עוד לא אושר)" : ""}`;
  return `${p.title}: ${now.text}${p.status === "PROPOSED" ? " (מוצע, עוד לא אושר)" : ""}`;
}

/// A change to what a rule says, as opposed to its sources or status
/// note. Such a change to an approved rule sends it back for approval.
export function changesSubstance(
  before: { kind: string; title: string; statement: string; interimStatement: string | null; effectiveFrom?: Date | null },
  after: { kind?: string; title?: string; statement?: string; interimStatement?: string | null; effectiveFrom?: Date | null }
): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
  // When it starts is part of what it says: moving a stricter rule later
  // softens it.
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
  return (
    (after.effectiveFrom !== undefined && day(after.effectiveFrom) !== day(before.effectiveFrom)) ||
    (after.kind !== undefined && after.kind !== before.kind) ||
    (after.title !== undefined && norm(after.title) !== norm(before.title)) ||
    (after.statement !== undefined && norm(after.statement) !== norm(before.statement)) ||
    (after.interimStatement !== undefined && norm(after.interimStatement) !== norm(before.interimStatement))
  );
}

// ---------------------------------------------------------------------------
// Exceptions (spec 3.11, PolicyException)
// ---------------------------------------------------------------------------

/// The longest an exception may run. Longer is a change to the rule.
export const EXCEPTION_MAX_DAYS = 90;

export const EXCEPTION_STATUS_LABELS: Record<"REQUESTED" | "APPROVED" | "REJECTED" | "WITHDRAWN", string> = {
  REQUESTED: "ממתינה לאישור",
  APPROVED: "אושרה",
  REJECTED: "נדחתה",
  WITHDRAWN: "נמשכה",
};

/// `validUntil` is the last day it holds (UTC midnight of that day).
export function exceptionShapeError(e: { what?: string | null; reason?: string | null; validUntil?: Date | null }, now: Date): string | null {
  if (!e.what?.trim()) return "צריך לכתוב מה עושים אחרת.";
  if (!e.reason?.trim()) return "צריך לכתוב למה.";
  if (!e.validUntil || Number.isNaN(e.validUntil.getTime())) return "חריגה צריכה תאריך סיום.";
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (e.validUntil.getTime() < today) return "תאריך הסיום כבר עבר.";
  if (e.validUntil.getTime() > today + EXCEPTION_MAX_DAYS * 24 * 60 * 60 * 1000) {
    return `חריגה היא עד ${EXCEPTION_MAX_DAYS} יום. לתקופה ארוכה יותר משנים את הכלל עצמו.`;
  }
  return null;
}

/// Approved and its last day not yet over.
export function isExceptionInForce(e: { status: string; validUntil: Date }, now: Date): boolean {
  return e.status === "APPROVED" && e.validUntil.getTime() + 24 * 60 * 60 * 1000 > now.getTime();
}
