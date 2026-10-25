// Processes and their procedures: the words, the shape of a step, and the
// checks that need no database (claude/org-brain-spec-2026-10-12.md, 3.8,
// 3.9, 7.2). Pure, so the screen, the file, the server and the tests read
// a process the same way.

import { findSecrets } from "@/lib/secret-scan";

export type StepModeLike = "MANUAL" | "ASSISTED" | "AUTOMATED";
export type TriggerLike = "SCHEDULED" | "EVENT" | "ON_DEMAND" | "CONTINUOUS";
export type TransitionLike = "WITH_CLIENT" | "IN_HANDOVER" | "WITH_ANKORA" | "NOT_PLANNED";

export const MAX_PROCESS_STEPS = 15;

export const STEP_MODE_LABELS: Record<StepModeLike, string> = {
  MANUAL: "ידני",
  ASSISTED: "Claude מכין, אדם בודק",
  AUTOMATED: "אוטומטי",
};

export const TRIGGER_LABELS: Record<TriggerLike, string> = {
  SCHEDULED: "לפי מועד",
  EVENT: "כשמשהו קורה",
  ON_DEMAND: "לפי בקשה",
  CONTINUOUS: "שוטף",
};

export const TRANSITION_LABELS: Record<TransitionLike, string> = {
  WITH_CLIENT: "אצל הלקוח",
  IN_HANDOVER: "בחפיפה",
  WITH_ANKORA: "אצלנו",
  NOT_PLANNED: "לא עובר אלינו",
};

/// A closed vocabulary (spec 3.9): what a step does, as far as the rules
/// care.
export const ACTION_TAGS = [
  "PAYMENT",
  "PURCHASE",
  "INVOICE",
  "SUPPLIER_NEW",
  "CONTRACT",
  "PRICE_CHANGE",
  "REFUND",
  "CLIENT_MESSAGE",
  "CREDENTIAL_ACCESS",
  "DATA_EXPORT",
  "HR",
  "LEGAL",
  "BANK_SIGNATURE",
] as const;
export type ActionTag = (typeof ACTION_TAGS)[number];

export const ACTION_TAG_LABELS: Record<ActionTag, string> = {
  PAYMENT: "תשלום",
  PURCHASE: "רכישה",
  INVOICE: "חשבונית",
  SUPPLIER_NEW: "ספק חדש",
  CONTRACT: "חוזה",
  PRICE_CHANGE: "שינוי מחיר",
  REFUND: "זיכוי או החזר",
  CLIENT_MESSAGE: "הודעה ללקוח",
  CREDENTIAL_ACCESS: "גישה לסיסמאות",
  DATA_EXPORT: "ייצוא מידע",
  HR: "משאבי אנוש",
  LEGAL: "משפטי",
  BANK_SIGNATURE: "חתימה בבנק",
};

/// "מה AI לא עושה" in Ankora's SOP book: financial commitments, price
/// changes, signing contracts, legal decisions, approving a new supplier.
/// A step that does one of these is never automated, and when Claude
/// prepares it a person approves it.
export const HUMAN_ONLY_TAGS: ActionTag[] = ["PAYMENT", "PURCHASE", "REFUND", "PRICE_CHANGE", "CONTRACT", "BANK_SIGNATURE", "LEGAL", "SUPPLIER_NEW"];

/// "כל תוצר AI עובר בדיקה אנושית לפני מסירה ללקוח": never automated.
export const HUMAN_REVIEWED_TAGS: ActionTag[] = ["CLIENT_MESSAGE"];

/// Money moving: what a client's approval thresholds are about (R2).
export const MONEY_TAGS: ActionTag[] = ["PAYMENT", "PURCHASE", "REFUND"];

/// How a step reaches someone, when it does (R10).
export const CHANNELS = ["EMAIL", "WHATSAPP", "SLACK", "PHONE", "PORTAL", "OTHER"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  EMAIL: "מייל",
  WHATSAPP: "WhatsApp",
  SLACK: "Slack",
  PHONE: "טלפון",
  PORTAL: "הפורטל",
  OTHER: "אחר",
};

export type ProcessStep = {
  title: string;
  mode: StepModeLike;
  /// Business days from the run's date; negative is before it.
  offsetBusinessDays: number | null;
  actionTags: ActionTag[];
  /// SystemAccess ids of the client.
  systemIds: string[];
  output: string | null;
  /// For an automated step: how a person makes sure it happened (R3).
  verification: string | null;
  requiresApproval: boolean;
  /// The most this step moves, in minor units, with its currency. Unknown
  /// is read as "may be above any threshold" (R2).
  amountMaxMinor: number | null;
  currency: string | null;
  /// How a message in this step goes out (R10).
  channel: Channel | null;
};

const s = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/// Whatever was stored or sent, as steps. Unknown tags and modes are
/// dropped rather than trusted.
export function readSteps(value: unknown): ProcessStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v) => ({
      title: s(v.title, 200) ?? "",
      mode: (["MANUAL", "ASSISTED", "AUTOMATED"] as const).includes(v.mode as StepModeLike) ? (v.mode as StepModeLike) : "MANUAL",
      offsetBusinessDays:
        typeof v.offsetBusinessDays === "number" && Number.isInteger(v.offsetBusinessDays) && Math.abs(v.offsetBusinessDays) <= 60 ? v.offsetBusinessDays : null,
      actionTags: Array.isArray(v.actionTags) ? [...new Set((v.actionTags as unknown[]).filter((t): t is ActionTag => ACTION_TAGS.includes(t as ActionTag)))] : [],
      systemIds: Array.isArray(v.systemIds) ? [...new Set((v.systemIds as unknown[]).filter((x): x is string => typeof x === "string" && !!x))] : [],
      output: s(v.output, 500),
      verification: s(v.verification, 500),
      requiresApproval: v.requiresApproval === true,
      amountMaxMinor:
        typeof v.amountMaxMinor === "number" && Number.isInteger(v.amountMaxMinor) && v.amountMaxMinor >= 0 && v.amountMaxMinor <= 1e13 ? v.amountMaxMinor : null,
      currency: typeof v.currency === "string" && /^[A-Za-z]{3}$/.test(v.currency.trim()) ? v.currency.trim().toUpperCase() : null,
      channel: CHANNELS.includes(v.channel as Channel) ? (v.channel as Channel) : null,
    }))
    .filter((st) => st.title);
}

export type CheckResult = { code: string; message: string; step?: number };

/// The checks that block approval of a procedure (R1 to R4). `thresholds`
/// are the titles of the client's approval rules in force (THRESHOLD,
/// APPROVAL_REQUIRED), proposed ones included through their interim rule.
export function blockingChecks(
  version: { steps: ProcessStep[]; highlights?: string | null; outputs?: string | null },
  thresholds: string[]
): CheckResult[] {
  const out: CheckResult[] = [];
  version.steps.forEach((st, i) => {
    const n = i + 1;
    const humanOnly = st.actionTags.filter((t) => HUMAN_ONLY_TAGS.includes(t));
    if (humanOnly.length && st.mode === "AUTOMATED") {
      out.push({ code: "R1", step: n, message: `שלב ${n}: ${humanOnly.map((t) => ACTION_TAG_LABELS[t]).join(", ")} לא נעשה אוטומטית. לפי ספר הנהלים זו החלטה של אדם.` });
    } else if (humanOnly.length && st.mode === "ASSISTED" && !st.requiresApproval) {
      out.push({ code: "R1", step: n, message: `שלב ${n}: כש-Claude מכין ${humanOnly.map((t) => ACTION_TAG_LABELS[t]).join(", ")}, אדם מאשר לפני הביצוע. צריך לסמן "דורש אישור".` });
    }
    if (st.mode === "AUTOMATED" && st.actionTags.some((t) => HUMAN_REVIEWED_TAGS.includes(t))) {
      out.push({ code: "R1", step: n, message: `שלב ${n}: הודעה ללקוח עוברת בדיקה של אדם לפני שהיא יוצאת, ולכן לא נשלחת אוטומטית.` });
    }
    if (st.mode === "AUTOMATED" && !st.verification) {
      out.push({ code: "R3", step: n, message: `שלב ${n} אוטומטי: צריך לכתוב איך אדם מוודא שזה קרה.` });
    }
  });
  const moves = version.steps.some((st) => st.actionTags.some((t) => MONEY_TAGS.includes(t)));
  if (moves && thresholds.length > 0 && !version.steps.some((st) => st.requiresApproval)) {
    out.push({ code: "R2", message: `בנוהל יש תשלום או רכישה, ולכללי האישור של הלקוח (${thresholds.join(", ")}) אין שלב אישור.` });
  }
  const text = [
    ...version.steps.flatMap((st) => [st.title, st.output, st.verification]),
    version.highlights,
    version.outputs,
  ]
    .filter(Boolean)
    .join("\n");
  const secrets = findSecrets(text);
  if (secrets.length) out.push({ code: "R4", message: `בנוהל יש ${secrets.map((x) => x.label).join(", ")}. סודות נשמרים בכספת, לא בנוהל.` });
  return out;
}

/// What a process needs before it can be trusted with a run (spec 3.8,
/// Oren's nine fields). Each missing one is a gap, and the score is how
/// many of the nine are there.
export type CompletenessInput = {
  ownerId: string | null;
  triggerKinds: TriggerLike[];
  triggerText: string | null;
  slaText: string | null;
  slaBusinessDays: number | null;
  requiredSystemIds: string[];
  /// Of the required systems, those we cannot use now (R11).
  systemsWithoutAccess: string[];
  approverText: string | null;
  approverContactId: string | null;
  approverUserId?: string | null;
  approvalPolicyIds: string[];
  approvalText: string | null;
  externalPartyContactIds: string[];
  externalPartyText: string | null;
  exceptionPlaybook: string | null;
  /// For a scheduled process: the next occurrence of its dates, if any.
  nextDate: Date | null;
  /// Fields marked "לא רלוונטי" (NOT_APPLICABLE_FIELDS).
  notApplicableFields?: unknown;
  /// A step or a text of the process names a contact or a firm of the file.
  mentionedExternal?: boolean;
};

export const NINE_FIELDS = ["owner", "trigger", "sla", "systems", "permissions", "approvals", "external", "exceptions", "next"] as const;
export type FieldKey = (typeof NINE_FIELDS)[number];

export const FIELD_LABELS: Record<FieldKey, string> = {
  owner: "בעלים",
  trigger: "טריגר",
  sla: "SLA",
  systems: "מערכות",
  permissions: "הרשאות",
  approvals: "ספי אישור ומאשר",
  external: "גורם חיצוני",
  exceptions: "נוהל חריגים",
  next: "מועד הבא",
};

/// 25.10.2026 (Ariel: "there is always something missing"): what a
/// process needs to run (owner, trigger, a date when it runs by one) is
/// read by lib/process-readiness.ts. The rest is how well it is written
/// down, shown quietly, and any of it can be marked not relevant.
export const DOC_FIELDS = ["sla", "systems", "permissions", "approvals", "external", "exceptions"] as const;
export type DocField = (typeof DOC_FIELDS)[number];

/// The fields a person may mark "לא רלוונטי". Permissions follow systems:
/// no systems, nothing to have access to.
export const NOT_APPLICABLE_FIELDS = ["sla", "systems", "approvals", "external", "exceptions"] as const;
export type NotApplicableField = (typeof NOT_APPLICABLE_FIELDS)[number];

export function readNotApplicable(v: unknown): NotApplicableField[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is NotApplicableField => typeof x === "string" && (NOT_APPLICABLE_FIELDS as readonly string[]).includes(x)))];
}

function notApplicableSet(p: CompletenessInput): Set<FieldKey> {
  const na = new Set<FieldKey>(readNotApplicable(p.notApplicableFields));
  if (na.has("systems")) na.add("permissions");
  return na;
}

function fieldsPresent(p: CompletenessInput): Record<FieldKey, boolean> {
  return {
    owner: !!p.ownerId,
    trigger: p.triggerKinds.length > 0 && !!p.triggerText?.trim(),
    sla: !!p.slaText?.trim() || p.slaBusinessDays !== null,
    systems: p.requiredSystemIds.length > 0,
    // No systems, nothing to have access to: the "systems" gap says it.
    permissions: p.requiredSystemIds.length > 0 && p.systemsWithoutAccess.length === 0,
    // 25.10.2026: a named approver is enough. A linked approval rule or
    // the thresholds in words add to it, but are not required.
    approvals: !!p.approverText?.trim() || !!p.approverContactId || !!p.approverUserId,
    // A step or a text that names a contact or a firm of the file counts.
    external: p.externalPartyContactIds.length > 0 || !!p.externalPartyText?.trim() || !!p.mentionedExternal,
    exceptions: !!p.exceptionPlaybook?.trim(),
    // Only a scheduled process has a next date to know.
    next: !p.triggerKinds.includes("SCHEDULED") || p.nextDate !== null,
  };
}

/// All nine, less the ones marked not relevant: `of` is what is left.
export function completeness(p: CompletenessInput): { score: number; of: number; missing: FieldKey[] } {
  const has = fieldsPresent(p);
  const na = notApplicableSet(p);
  const counted = NINE_FIELDS.filter((k) => !na.has(k));
  const missing = counted.filter((k) => !has[k]);
  return { score: counted.length - missing.length, of: counted.length, missing };
}

/// How well it is written down: the documentation fields only, less the
/// ones not relevant. Quiet: nothing here stops a run.
export function documentation(p: CompletenessInput): { score: number; of: number; missing: DocField[]; notApplicable: NotApplicableField[] } {
  const has = fieldsPresent(p);
  const na = notApplicableSet(p);
  const counted = DOC_FIELDS.filter((k) => !na.has(k));
  const missing = counted.filter((k) => !has[k]);
  return { score: counted.length - missing.length, of: counted.length, missing, notApplicable: readNotApplicable(p.notApplicableFields) };
}

/// "תיעוד 4 מתוך 6", or "תיעוד מלא".
export function documentationLine(d: { score: number; of: number }): string {
  return d.score >= d.of ? "תיעוד מלא" : `תיעוד ${d.score} מתוך ${d.of}`;
}

/// The gaps a reader sees on the process (R11, R12, R13), in words.
/// 22.10.2026: no backup is no longer a gap (Ariel: what lets someone step
/// in is an approved procedure and access, not a name on the process).
export function processGaps(p: CompletenessInput & { backupOwnerId?: string | null }, systemName: (id: string) => string): string[] {
  const gaps: string[] = [];
  const { missing } = completeness(p);
  for (const k of missing) if (k !== "permissions") gaps.push(`חסר: ${FIELD_LABELS[k]}`);
  if (p.systemsWithoutAccess.length && !notApplicableSet(p).has("systems")) gaps.push(`אין לנו גישה ל: ${p.systemsWithoutAccess.map(systemName).join(", ")}`);
  return gaps;
}
