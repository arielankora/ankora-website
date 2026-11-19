// What a proposal to update an item already in the file changes, field by
// field: what the file says today and what it will say once approved
// (19.11.2026, Ariel). The card used to strike out the item's line and
// show nothing in its place: a contact whose name did not change came as
// an empty headline under a struck-out name, and read as "delete Haim".
//
// Pure, so the review screen, the MCP tools and the check made when a
// proposal arrives share one answer to "what does it change".

export type ChangeValue = string | number | boolean | string[] | null;

export type ProposalChange = {
  /// The payload field, as the proposal names it.
  field: string;
  /// What the file says now. Null: nothing written. `beforeKnown` false:
  /// the field is a name the file keeps as a link, not read here.
  before: ChangeValue;
  beforeKnown: boolean;
  after: ChangeValue;
};

/// Fields that are about the proposal, not the item: never a change.
const NOT_A_FIELD = new Set(["sources", "at", "reason", "confidence", "quote", "alsoSources", "baseVersion", "highlights", "outputs"]);

/// Fields whose value is a code, worded by whoever shows it.
export const CODE_FIELDS = new Set([
  "knowledgeStatus",
  "importance",
  "sensitivity",
  "relationship",
  "ourPermission",
  "accessStatus",
  "billingCycle",
  "kind",
  "transitionStatus",
  "triggerKinds",
  "notApplicableFields",
]);

/// Amounts kept in minor units (agorot, cents), shown in whole units.
const MINOR_FIELDS = new Set(["monthlyCostMinor", "billingCostMinor"]);

/// One value as it is compared and shown: trimmed text, an empty text or
/// list as nothing, a procedure as its steps' count.
export function normalizeChangeValue(field: string, v: unknown): ChangeValue {
  if (v === undefined || v === null) return null;
  if (field === "steps" && Array.isArray(v)) return v.length ? v.length : null;
  if (typeof v === "string") return v.trim() ? v.trim() : null;
  if (typeof v === "number") return MINOR_FIELDS.has(field) ? v / 100 : v;
  if (typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) {
    const items = v
      .map((x) => (typeof x === "string" ? x.trim() : x && typeof x === "object" && "system" in x && "id" in x ? `${(x as { system: unknown }).system}:${(x as { id: unknown }).id}` : JSON.stringify(x)))
      .filter((x) => x);
    return items.length ? items : null;
  }
  if (typeof v === "object") return Object.keys(v as object).length ? JSON.stringify(v) : null;
  return String(v);
}

function same(a: ChangeValue, b: ChangeValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const x = [...a].sort();
    const y = [...b].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return a === b;
}

/// The fields the proposal sets that differ from the item as it is now.
/// `current` holds the item's fields by the proposal's names; a field it
/// does not hold (a link kept by id) is listed with `beforeKnown` false.
export function proposalChanges(payload: Record<string, unknown>, current: Record<string, unknown>): ProposalChange[] {
  const out: ProposalChange[] = [];
  for (const [field, raw] of Object.entries(payload)) {
    if (raw === undefined || NOT_A_FIELD.has(field)) continue;
    const after = normalizeChangeValue(field, raw);
    const beforeKnown = Object.prototype.hasOwnProperty.call(current, field);
    const before = beforeKnown ? normalizeChangeValue(field, current[field]) : null;
    if (beforeKnown && same(before, after)) continue;
    // A name the file keeps by id, given empty: says nothing.
    if (!beforeKnown && after === null) continue;
    out.push({ field, before, beforeKnown, after });
  }
  return out;
}

/// Hebrew words for the fields and the codes, for Claude (the MCP tools
/// speak Hebrew to it) and as the screen's fallback. The screen words them
/// from its dictionary (knowledge.changes), in the reader's language.
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  name: "שם",
  role: "תפקיד",
  relationship: "סוג הקשר",
  emails: "מייל",
  phones: "טלפון",
  organizationName: "ארגון",
  entityName: "ישות",
  context: "הקשר",
  channelOrder: "ערוצים",
  isPrimary: "איש קשר ראשי",
  isDecisionMaker: "מקבל החלטות",
  endedAt: "מסיים ב",
  knowledgeStatus: "סטטוס",
  toResolve: "מה יסגור את זה",
  importance: "חשיבות",
  sensitivity: "רגישות",
  doNotDisclose: "לא לספר",
  clientVisible: "גלוי ללקוח",
  ownerName: "בעלים",
  externalRefs: "הפניות",
  domains: "דומיינים",
  monthlyCostMinor: "עלות חודשית",
  currency: "מטבע",
  notes: "הערות",
  systemName: "מערכת",
  purpose: "מטרה",
  url: "כתובת",
  accountUsed: "חשבון",
  ourPermission: "ההרשאה שלנו",
  accessStatus: "גישה",
  blocker: "מה חוסם",
  clientAdmin: "מנהל אצל הלקוח",
  billingCycle: "מחזור חיוב",
  billingCostMinor: "עלות",
  billingCurrency: "מטבע חיוב",
  cardLast4: "כרטיס",
  invoiceTo: "חשבונית אל",
  title: "כותרת",
  fromWho: "ממי",
  arrivesVia: "מגיע דרך",
  handling: "טיפול",
  routeToNames: "מועבר אל",
  processName: "תהליך",
  kind: "סוג",
  statement: "הכלל",
  rationale: "למה",
  interimStatement: "עד שמאושר",
  effectiveFrom: "בתוקף מ",
  reviewBy: "לסקירה עד",
  params: "פרמטרים",
  interimParams: "פרמטרים עד שמאושר",
  legalName: "שם משפטי",
  registrationNumber: "מספר רישום",
  country: "מדינה",
  billingAddress: "כתובת לחיוב",
  parentName: "ישות אם",
  triggerKinds: "מה מפעיל",
  triggerText: "מה מפעיל",
  slaText: "SLA",
  externalPartyText: "גורם חיצוני",
  approverText: "מאשר",
  approvalText: "אישור",
  exceptionPlaybook: "חריגים",
  executorText: "מבצע",
  transitionStatus: "אצל מי",
  steps: "שלבי הנוהל",
  externalPartyNames: "גורמים חיצוניים",
  systemNames: "מערכות",
  approverName: "מאשר",
  approvalPolicyTitles: "כללי אישור",
  notApplicableFields: "לא רלוונטי",
  body: "תוכן",
  topic: "נושא",
  referTo: "להפנות אל",
  validUntil: "בתוקף עד",
  validUntilEvent: "בתוקף עד ש",
  decidedAt: "הוחלט ב",
  decidedBy: "החליט",
  subjectName: "של מי",
};

const CODE_WORDS: Record<string, string> = {
  CONFIRMED: "ודאי",
  UNCERTAIN: "לא ודאי",
  MISSING: "חסר",
  NORMAL: "רגיל",
  LOW: "נמוכה",
  SENSITIVE: "רגיש",
  CLIENT_STAFF: "צוות הלקוח",
  PROVIDER: "נותן שירות",
  ADVISOR: "יועץ",
  INVESTOR: "משקיע",
  SUPPLIER: "ספק",
  ANKORA: "אנקורה",
  HAS_ACCESS: "יש גישה",
  PENDING: "ממתין",
  NO_ACCESS: "אין גישה",
  NOT_NEEDED: "לא נדרש",
  MONTHLY: "חודשי",
  ANNUAL: "שנתי",
  OTHER: "אחר",
};

/// A value in Hebrew words, or null for "nothing written".
export function changeValueText(field: string, v: ChangeValue): string | null {
  if (v === null) return null;
  if (typeof v === "boolean") return v ? "כן" : "לא";
  if (field === "steps" && typeof v === "number") return `${v} שלבים, טיוטה חדשה`;
  if (Array.isArray(v)) return v.map((x) => (CODE_FIELDS.has(field) ? CODE_WORDS[x] ?? x : x)).join(", ");
  if (typeof v === "string" && CODE_FIELDS.has(field)) return CODE_WORDS[v] ?? v;
  return String(v);
}

/// The changes as Claude reads them: the field's name, before and after,
/// in words. A field the file keeps as a link says so instead of a value.
export function changesForAi(changes: ProposalChange[]): { field: string; before: string; after: string }[] {
  return changes.map((c) => ({
    field: CHANGE_FIELD_LABELS[c.field] ?? c.field,
    before: c.beforeKnown ? changeValueText(c.field, c.before) ?? "לא כתוב" : "לא נבדק כאן",
    after: changeValueText(c.field, c.after) ?? "יימחק",
  }));
}

/// Why an update is not sent to a person, or null when it changes
/// something (19.11.2026, Ariel: work on the approvals screen that changes
/// nothing is work nobody should do). Said to Claude when it proposes.
export function noChangeReason(payload: Record<string, unknown>, current: Record<string, unknown>): string | null {
  const changes = proposalChanges(payload, current);
  if (changes.length === 0) return "העדכון לא משנה אף שדה בפריט שבתיק. שולחים רק מה שהשתנה, ואם לא השתנה כלום, לא שולחים.";
  const doubtOnly = changes.every((c) => c.field === "knowledgeStatus" || c.field === "toResolve");
  const status = payload.knowledgeStatus;
  if (doubtOnly && status !== "CONFIRMED") {
    return "העדכון רק מסמן את הפריט כלא ודאי ומוסיף שאלה. שאלה על פריט נשלחת כעובדה מסוג QUESTION, ומה שנאמר אחרת עליו כ-CONTRADICT, לא כגרסה חדשה שלו.";
  }
  return null;
}
