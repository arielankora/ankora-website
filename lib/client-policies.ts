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
  COMMUNICATION: "באיזה ערוץ עושים מה. כשבוחרים ערוצים מותרים, כל הודעה ללקוח בנוהל נבדקת מולם.",
  SEPARATION: "מה נשאר מופרד, למשל בין ישויות. נוהל עם כסף או חשבוניות צריך ישות.",
  APPROVAL_REQUIRED: "מה דורש אישור, וממי. ייבדק מול שלבי נוהל.",
  THRESHOLD: "סכום שמעליו צריך אישור. ייבדק מול שלבי נוהל.",
  REQUIRED_STEP: "שלב שחייב להיות. כשבוחרים פעולה ושלב חובה, כל נוהל שעושה את הפעולה נבדק.",
  TIMING: "כמה זמן לפני. כשבוחרים פעולה וימי עסקים, כל שלב כזה בנוהל נבדק.",
  FORBIDDEN: "מה אסור לכולם, לא רק ל-AI. כשבוחרים פעולות, שלב שעושה אחת מהן בנוהל נבדק.",
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
export function ruleInForce(p: { status: PolicyStatusLike; statement: string; interimStatement: string | null }): { text: string; interim: boolean } | null {
  if (p.status === "RETIRED") return null;
  if (p.status === "PROPOSED" && p.interimStatement?.trim()) return { text: p.interimStatement.trim(), interim: true };
  return { text: p.statement.trim(), interim: false };
}

/// The rule as one line for a reader who has nothing else: Claude in an
/// extraction prompt, or the file's section 6.
export function ruleLine(p: { title: string; status: PolicyStatusLike; statement: string; interimStatement: string | null }): string | null {
  const now = ruleInForce(p);
  if (!now) return null;
  if (now.interim) return `${p.title}: עד שהכלל יאושר, ${now.text} (הכלל המוצע: ${p.statement.trim()})`;
  return `${p.title}: ${now.text}${p.status === "PROPOSED" ? " (מוצע, עוד לא אושר)" : ""}`;
}

/// A change to what a rule says, as opposed to its sources or status
/// note. Such a change to an approved rule sends it back for approval.
export function changesSubstance(
  before: { kind: string; title: string; statement: string; interimStatement: string | null },
  after: { kind?: string; title?: string; statement?: string; interimStatement?: string | null }
): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
  return (
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

// ---------------------------------------------------------------------------
// What the server checks of a rule (spec 7.2)
// ---------------------------------------------------------------------------

/// The structured part of a rule: which fields each kind takes. A field a
/// kind does not take is dropped, so a FORBIDDEN rule never carries a
/// channel list nobody will read.
export type PolicyCheckFields = {
  checkTags: string[];
  requiredTags: string[];
  channels: string[];
  minLeadBusinessDays: number | null;
};

export const CHECK_FIELDS_BY_KIND: Partial<Record<PolicyKindLike, (keyof PolicyCheckFields)[]>> = {
  FORBIDDEN: ["checkTags"],
  REQUIRED_STEP: ["checkTags", "requiredTags"],
  TIMING: ["checkTags", "minLeadBusinessDays"],
  COMMUNICATION: ["channels"],
};

export const NO_CHECK: PolicyCheckFields = { checkTags: [], requiredTags: [], channels: [], minLeadBusinessDays: null };

/// Only what the kind takes, deduplicated.
export function checkFieldsFor(kind: PolicyKindLike, f: Partial<PolicyCheckFields>): PolicyCheckFields {
  const takes = CHECK_FIELDS_BY_KIND[kind] ?? [];
  const list = (v: string[] | undefined) => [...new Set((v ?? []).filter(Boolean))];
  return {
    checkTags: takes.includes("checkTags") ? list(f.checkTags) : [],
    requiredTags: takes.includes("requiredTags") ? list(f.requiredTags) : [],
    channels: takes.includes("channels") ? list(f.channels) : [],
    minLeadBusinessDays: takes.includes("minLeadBusinessDays") ? f.minLeadBusinessDays ?? null : null,
  };
}

/// Half a check is no check: it is refused rather than stored as if it
/// were one.
export function checkFieldsError(kind: PolicyKindLike, f: PolicyCheckFields): string | null {
  if (kind === "REQUIRED_STEP" && f.requiredTags.length && !f.checkTags.length) return "שלב חובה: צריך לבחור גם על איזו פעולה הוא חל.";
  if (kind === "REQUIRED_STEP" && f.checkTags.length && !f.requiredTags.length) return "שלב חובה: צריך לבחור איזה שלב חייב להיות.";
  if (kind === "TIMING" && f.minLeadBusinessDays !== null && (!Number.isInteger(f.minLeadBusinessDays) || f.minLeadBusinessDays < 1 || f.minLeadBusinessDays > 60)) {
    return "תזמון: בין 1 ל-60 ימי עסקים.";
  }
  if (kind === "TIMING" && (f.minLeadBusinessDays !== null) !== f.checkTags.length > 0) return "תזמון: צריך לבחור גם פעולה וגם כמה ימי עסקים לפני.";
  return null;
}

/// Whether the server checks this rule at all.
export function isChecked(f: PolicyCheckFields): boolean {
  return f.checkTags.length > 0 || f.requiredTags.length > 0 || f.channels.length > 0 || f.minLeadBusinessDays !== null;
}

export function sameCheckFields(a: PolicyCheckFields, b: PolicyCheckFields): boolean {
  const eq = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join() === [...y].sort().join();
  return eq(a.checkTags, b.checkTags) && eq(a.requiredTags, b.requiredTags) && eq(a.channels, b.channels) && a.minLeadBusinessDays === b.minLeadBusinessDays;
}
