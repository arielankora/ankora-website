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
  COMMUNICATION: "באיזה ערוץ עושים מה. ייבדק מול שלבי נוהל כשיהיו תהליכים.",
  SEPARATION: "מה נשאר מופרד, למשל בין ישויות. ייבדק מול שלבי נוהל וסוגי פניות.",
  APPROVAL_REQUIRED: "מה דורש אישור, וממי. ייבדק מול שלבי נוהל.",
  THRESHOLD: "סכום שמעליו צריך אישור. ייבדק מול שלבי נוהל.",
  REQUIRED_STEP: "שלב שחייב להיות. ייבדק מול שלבי נוהל.",
  TIMING: "כמה זמן לפני. ייבדק מול מועדים ותהליכים.",
  FORBIDDEN: "מה אסור לכולם, לא רק ל-AI.",
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
