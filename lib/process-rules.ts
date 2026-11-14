// Processes and their procedures: the words, the shape of a step, and the
// checks that need no database (claude/org-brain-spec-2026-10-12.md, 3.8,
// 3.9, 7.2). Pure, so the screen, the file, the server and the tests read
// a process the same way.

import { findSecrets, type SecretHit } from "@/lib/secret-scan";

type SecretKind = SecretHit["kind"];

export type StepModeLike = "MANUAL" | "ASSISTED" | "AUTOMATED";
export type TriggerLike = "SCHEDULED" | "EVENT" | "ON_DEMAND" | "CONTINUOUS" | "EXTERNAL";
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
  EXTERNAL: "אוטומטי, מחוץ לאפליקציה",
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
  /// Derived since 14.11.2026 (stage 3, spec 4.4): the step names an
  /// approver. Kept as a field so every reader of a stored step goes on
  /// working; a step stored before then may say true with no approver.
  requiresApproval: boolean;
  /// 14.11.2026 (processes redesign, stage 3, spec 4.4): who approves this
  /// step. An Ankora user is a gate (the run's step reaches done only with
  /// their signature); a contact at the client is not, but the step is
  /// closed only with when and how they approved. At most one of the two.
  approverUserId?: string | null;
  approverContactId?: string | null;
  /// "איך יודעים שבוצע": what shows the step was done (spec 4.4).
  evidence?: string | null;
  /// The most this step moves, in minor units, with its currency. Unknown
  /// is read as "may be above any threshold" (R2).
  amountMaxMinor: number | null;
  currency: string | null;
  /// How a message in this step goes out (R10).
  channel: Channel | null;
  /// A client message whose wording a person wrote in the procedure editor,
  /// with only fixed parameters filled in at send time (Ariel, 4.11.2026,
  /// task cmvtivumj000pjs08q9qj4t67). Such a message may go out on its own:
  /// a person checked what leaves, which is what R1 asks. Text Claude writes
  /// during a run is never this, and stays a draft.
  fixedMessage?: boolean;
};

const s = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/// A step's approver as stored: a user or a contact, never both (the user
/// wins), and `requiresApproval` true whenever one is named.
function approverOf(v: Record<string, unknown>): Pick<ProcessStep, "requiresApproval" | "approverUserId" | "approverContactId"> {
  const userId = typeof v.approverUserId === "string" && v.approverUserId.trim() ? v.approverUserId.trim() : null;
  const contactId = !userId && typeof v.approverContactId === "string" && v.approverContactId.trim() ? v.approverContactId.trim() : null;
  // Only what is named is written, so a step stored before stage 3 reads
  // back exactly as it was.
  return { requiresApproval: v.requiresApproval === true || !!userId || !!contactId, ...(userId ? { approverUserId: userId } : {}), ...(contactId ? { approverContactId: contactId } : {}) };
}

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
      ...approverOf(v),
      ...(s(v.evidence, 500) ? { evidence: s(v.evidence, 500) } : {}),
      amountMaxMinor:
        typeof v.amountMaxMinor === "number" && Number.isInteger(v.amountMaxMinor) && v.amountMaxMinor >= 0 && v.amountMaxMinor <= 1e13 ? v.amountMaxMinor : null,
      currency: typeof v.currency === "string" && /^[A-Za-z]{3}$/.test(v.currency.trim()) ? v.currency.trim().toUpperCase() : null,
      channel: CHANNELS.includes(v.channel as Channel) ? (v.channel as Channel) : null,
      ...(v.fixedMessage === true ? { fixedMessage: true } : {}),
    }))
    .filter((st) => st.title);
}

/// ADR 0006: what a check says, as a key a screen words in the reader's
/// language. `message` stays the Hebrew sentence every other reader (the
/// file, Claude, the stored approval) has always had; a screen that knows
/// the key words it from clients.processes.checks.<key>.
export type CheckKey = "humanOnlyAutomated" | "humanOnlyAssisted" | "clientMessageAutomated" | "automatedNoVerification" | "moneyNoApproval" | "secrets";
export type KeyedCheck = { key: CheckKey; step?: number; tags?: ActionTag[]; thresholds?: string[]; secrets?: SecretKind[] };

export type CheckResult = { code: string; message: string; step?: number; keyed?: KeyedCheck };

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
      out.push({ code: "R1", step: n, message: `שלב ${n}: ${humanOnly.map((t) => ACTION_TAG_LABELS[t]).join(", ")} לא נעשה אוטומטית. לפי ספר הנהלים זו החלטה של אדם.`, keyed: { key: "humanOnlyAutomated", step: n, tags: humanOnly } });
    } else if (humanOnly.length && st.mode === "ASSISTED" && !st.requiresApproval) {
      out.push({ code: "R1", step: n, message: `שלב ${n}: כש-Claude מכין ${humanOnly.map((t) => ACTION_TAG_LABELS[t]).join(", ")}, אדם מאשר לפני הביצוע. צריך לסמן "דורש אישור".`, keyed: { key: "humanOnlyAssisted", step: n, tags: humanOnly } });
    }
    if (st.mode === "AUTOMATED" && !st.fixedMessage && st.actionTags.some((t) => HUMAN_REVIEWED_TAGS.includes(t))) {
      out.push({ code: "R1", step: n, message: `שלב ${n}: הודעה ללקוח עוברת בדיקה של אדם לפני שהיא יוצאת, ולכן לא נשלחת אוטומטית.`, keyed: { key: "clientMessageAutomated", step: n } });
    }
    if (st.mode === "AUTOMATED" && !st.verification) {
      out.push({ code: "R3", step: n, message: `שלב ${n} אוטומטי: צריך לכתוב איך אדם מוודא שזה קרה.`, keyed: { key: "automatedNoVerification", step: n } });
    }
  });
  const moves = version.steps.some((st) => st.actionTags.some((t) => MONEY_TAGS.includes(t)));
  if (moves && thresholds.length > 0 && !version.steps.some((st) => st.requiresApproval)) {
    out.push({ code: "R2", message: `בנוהל יש תשלום או רכישה, ולכללי האישור של הלקוח (${thresholds.join(", ")}) אין שלב אישור.`, keyed: { key: "moneyNoApproval", thresholds } });
  }
  const text = [
    ...version.steps.flatMap((st) => [st.title, st.output, st.verification]),
    version.highlights,
    version.outputs,
  ]
    .filter(Boolean)
    .join("\n");
  const secrets = findSecrets(text);
  if (secrets.length) out.push({ code: "R4", message: `בנוהל יש ${secrets.map((x) => x.label).join(", ")}. סודות נשמרים בכספת, לא בנוהל.`, keyed: { key: "secrets", secrets: secrets.map((x) => x.kind) } });
  return out;
}

/// The label of the step field R3 asks for, as the procedure editor shows it.
export const VERIFICATION_FIELD_LABEL = "איך אדם מוודא שזה קרה";

/// "שלבים 2, 4 ו-5", or "שלב 3".
export function stepList(steps: number[]): string {
  if (steps.length === 1) return `שלב ${steps[0]}`;
  return `שלבים ${steps.slice(0, -1).join(", ")} ו-${steps[steps.length - 1]}`;
}

/// R3 on several steps, in one sentence: "שלבים 1, 2 ו-4 אוטומטיים: ...".
export function automatedStepsMessage(steps: number[]): string {
  return steps.length === 1
    ? `שלב ${steps[0]} אוטומטי: צריך לכתוב איך אדם מוודא שזה קרה.`
    : `${stepList(steps)} אוטומטיים: צריך לכתוב בכל אחד איך אדם מוודא שהשלב קרה.`;
}

/// The same R3 note on several steps becomes one line that names them
/// (3.11.2026: five identical lines said nothing the first did not). The
/// merged line takes the place of the first one; everything else keeps its
/// order and its own fields.
export function mergeStepChecks<T extends { code: string; message: string; step?: number }>(checks: T[]): (T & { steps?: number[] })[] {
  const r3 = checks.filter((c) => c.code === "R3" && c.step);
  if (r3.length < 2) return checks;
  const steps = r3.map((c) => c.step!);
  const out: (T & { steps?: number[] })[] = [];
  for (const c of checks) {
    if (c.code === "R3" && c.step) {
      // The merged sentence has no key of its own: a screen words it from
      // the message.
      if (c === r3[0]) out.push({ ...c, step: undefined, steps, message: automatedStepsMessage(steps), keyed: undefined });
      continue;
    }
    out.push(c);
  }
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
