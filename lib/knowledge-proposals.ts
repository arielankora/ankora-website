// Proposals to the client file: their shape, their words, and the checks
// that need no database (claude/org-brain-spec-2026-10-12.md, 5.1, 5.2).
// Pure, so the MCP tool, the domain and the review screen share one
// definition of what a proposal may say.

import { z } from "zod";
import { citedCodes, readSourceRefs } from "@/lib/knowledge-sources";
import { factShapeError, factShapeProblem } from "@/lib/client-facts";
import { NEEDS_INTERIM, type PolicyKindLike } from "@/lib/client-policies";
import { automatedStepsMessage, blockingChecks, readSteps, VERIFICATION_FIELD_LABEL } from "@/lib/process-rules";
import { clientVisibleBlocker } from "@/lib/knowledge";
import { DatePayload, dateShapeError, dateShapeProblem, dateWhen } from "@/lib/date-proposals";
import { parseExternalRefs, readExternalRefs, refLabel } from "@/lib/external-refs";
import { addBusinessDays } from "@/lib/business-calendar";

const knowledge = {
  knowledgeStatus: z.enum(["CONFIRMED", "UNCERTAIN", "MISSING"]).optional(),
  toResolve: z.string().max(500).nullish(),
  importance: z.enum(["NORMAL", "LOW"]).optional(),
  sensitivity: z.enum(["NORMAL", "SENSITIVE"]).optional(),
  doNotDisclose: z.string().max(500).nullish(),
  /// Spec 3.1: shown to the client in the portal, only when the client said
  /// it may be (it is theirs, or it was agreed with them).
  clientVisible: z.boolean().optional(),
  /// Spec 3.1: who at Ankora keeps the item right, by name.
  ownerName: z.string().max(200).nullish(),
  /// Spec 3.1: where the item lives elsewhere, as said ("RAID-002",
  /// "ClickUp:86c1x"). Kept as { system, id }.
  /// Stored already read, so it parses again when approved.
  externalRefs: z
    .array(z.union([z.string().max(120), z.object({ system: z.string().max(60), id: z.string().max(120) })]))
    .max(20)
    .optional()
    .transform((v) => (v === undefined ? undefined : parseExternalRefs(v.map((r) => (typeof r === "string" ? r : `${r.system}:${r.id}`)).join(","))))
};

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .nullish();

export const FactPayload = z.object({
  kind: z.enum(["SCOPE_IN", "SCOPE_OUT", "PREFERENCE", "REQUIREMENT", "LOCATION", "FINANCE", "TEMPORARY", "ONE_OFF_DECISION", "QUESTION", "NOTE"]),
  body: z.string().min(1).max(2000),
  topic: z.enum(["COMMUNICATION", "REPORTING", "DOCUMENTS", "AUTOMATION", "ADMINS", "PAYMENTS", "SUPPLIERS", "OTHER"]).nullish(),
  referTo: z.string().max(300).nullish(),
  validUntil: day,
  validUntilEvent: z.string().max(300).nullish(),
  decidedAt: day,
  decidedBy: z.string().max(200).nullish(),
  /// A preference's someone: a contact or a firm in the file, by name.
  subjectName: z.string().max(200).nullish(),
  ...knowledge,
});

export const ContactPayload = z.object({
  name: z.string().max(200).nullish(),
  role: z.string().max(200).nullish(),
  relationship: z.enum(["CLIENT_STAFF", "PROVIDER", "ADVISOR", "INVESTOR", "SUPPLIER", "ANKORA"]).optional(),
  emails: z.array(z.string().max(200)).max(10).optional(),
  phones: z.array(z.string().max(50)).max(10).optional(),
  organizationName: z.string().max(200).nullish(),
  context: z.string().max(2000).nullish(),
  channelOrder: z.array(z.string().max(50)).max(10).optional(),
  isPrimary: z.boolean().optional(),
  isDecisionMaker: z.boolean().optional(),
  /// The client's legal entity this person works with, by name.
  entityName: z.string().max(200).nullish(),
  ...knowledge,
});

export const OrganizationPayload = z.object({
  name: z.string().min(1).max(200),
  domains: z.array(z.string().max(200)).max(10).optional(),
  role: z.string().max(300).nullish(),
  relationship: z.enum(["PROVIDER", "ADVISOR", "SUPPLIER", "INVESTOR"]).optional(),
  monthlyCostMinor: z.number().int().nonnegative().nullish(),
  currency: z.enum(["ILS", "USD"]).nullish(),
  notes: z.string().max(2000).nullish(),
  ...knowledge,
});

export const SystemPayload = z.object({
  systemName: z.string().min(1).max(200),
  purpose: z.string().max(300).nullish(),
  url: z.string().max(500).nullish(),
  accountUsed: z.string().max(200).nullish(),
  ourPermission: z.enum(["NONE", "VIEWER", "USER", "BILLING", "ADMIN", "OWNER"]).optional(),
  accessStatus: z.enum(["HAS_ACCESS", "PENDING", "NO_ACCESS", "NOT_NEEDED"]).optional(),
  blocker: z.string().max(500).nullish(),
  clientAdmin: z.string().max(300).nullish(),
  notes: z.string().max(2000).nullish(),
  entityName: z.string().max(200).nullish(),
  /// Spec 3.6: how a SaaS is billed. The last four digits only, never a
  /// whole card number (the secret scan drops one anyway).
  billingCycle: z.enum(["MONTHLY", "ANNUAL", "OTHER"]).nullish(),
  billingCostMinor: z.number().int().nonnegative().nullish(),
  billingCurrency: z.enum(["ILS", "USD", "EUR"]).nullish(),
  cardLast4: z.string().regex(/^\d{4}$/, "4 ספרות").nullish(),
  invoiceTo: z.string().max(300).nullish(),
  ...knowledge,
});

export const RequestTypePayload = z.object({
  title: z.string().min(1).max(200),
  fromWho: z.string().max(200).nullish(),
  arrivesVia: z.string().max(200).nullish(),
  handling: z.string().min(1).max(2000),
  /// Spec 3.7, by name: who it goes to, the process it sets off, its entity.
  routeToNames: z.array(z.string().max(200)).max(10).optional(),
  processName: z.string().max(200).nullish(),
  entityName: z.string().max(200).nullish(),
  ...knowledge,
});

export const PolicyPayload = z.object({
  kind: z.enum(["DATA_HANDLING", "DISCLOSURE", "COMMUNICATION", "SEPARATION", "APPROVAL_REQUIRED", "THRESHOLD", "REQUIRED_STEP", "TIMING", "FORBIDDEN", "INFO"]),
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(2000),
  rationale: z.string().max(1000).nullish(),
  interimStatement: z.string().max(1000).nullish(),
  /// Spec 3.11: from when it binds, and when it is looked at again.
  effectiveFrom: day,
  reviewBy: day,
  /// What the server can check (lib/policy-params.ts): an amount, tags, a
  /// channel. Read for the kind; keys the kind does not take are dropped.
  params: z.record(z.string(), z.unknown()).nullish(),
  interimParams: z.record(z.string(), z.unknown()).nullish(),
  ...knowledge,
});

/// A legal entity of the client (spec 3.3). The parent is named, and
/// found among the client's entities when the proposal is approved.
export const EntityPayload = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(300).nullish(),
  registrationNumber: z.string().max(100).nullish(),
  country: z.string().max(100).nullish(),
  currency: z.string().max(10).nullish(),
  billingAddress: z.string().max(500).nullish(),
  parentName: z.string().max(200).nullish(),
  ...knowledge,
});

export const NARRATIVE_KIND_LABELS = { OVERVIEW: "סקירה", BACKGROUND: "רקע", OUR_ROLE: "התפקיד שלנו" } as const;

/// A new version of one of the file's free texts (spec 3.3). It replaces
/// the whole text, so it is written against the version that was current
/// when it was proposed: a text someone changed since is not overwritten.
/// The server records that version; Claude does not send it.
export const NarrativePayload = z.object({
  kind: z.enum(["OVERVIEW", "BACKGROUND", "OUR_ROLE"]),
  body: z.string().min(1).max(20000),
  baseVersion: z.number().int().nonnegative().optional(),
});

const ProposedStep = z.object({
  title: z.string().min(1).max(300),
  mode: z.enum(["MANUAL", "ASSISTED", "AUTOMATED"]).optional(),
  offsetBusinessDays: z.number().int().min(-60).max(60).nullish(),
  actionTags: z.array(z.string().max(40)).max(13).optional(),
  output: z.string().max(500).nullish(),
  verification: z.string().max(500).nullish(),
  requiresApproval: z.boolean().optional(),
  systemNames: z.array(z.string().max(200)).max(10).optional(),
});

/// A process (spec 3.8), with its procedure when it was described. It
/// enters the file as a draft: the procedure runs only once a manager
/// approves it, on the processes screen.
export const ProcessPayload = z.object({
  title: z.string().min(1).max(200),
  purpose: z.string().max(500).nullish(),
  triggerKinds: z.array(z.enum(["SCHEDULED", "EVENT", "ON_DEMAND", "CONTINUOUS"])).max(4).optional(),
  triggerText: z.string().max(500).nullish(),
  slaText: z.string().max(500).nullish(),
  externalPartyText: z.string().max(500).nullish(),
  approverText: z.string().max(300).nullish(),
  approvalText: z.string().max(500).nullish(),
  exceptionPlaybook: z.string().max(4000).nullish(),
  executorText: z.string().max(300).nullish(),
  transitionStatus: z.enum(["WITH_CLIENT", "IN_HANDOVER", "WITH_ANKORA", "NOT_PLANNED"]).optional(),
  steps: z.array(ProposedStep).max(15).optional(),
  highlights: z.string().max(4000).nullish(),
  outputs: z.string().max(2000).nullish(),
  /// Spec 3.8, by name: resolved in the client's file when it is approved.
  entityName: z.string().max(200).nullish(),
  externalPartyNames: z.array(z.string().max(200)).max(10).optional(),
  systemNames: z.array(z.string().max(200)).max(20).optional(),
  approverName: z.string().max(200).nullish(),
  approvalPolicyTitles: z.array(z.string().max(200)).max(10).optional(),
  /// 25.10.2026: documentation fields that do not apply to this process.
  notApplicableFields: z.array(z.enum(["sla", "systems", "approvals", "external", "exceptions"])).max(5).optional(),
  ...knowledge,
});

/// An email domain that identifies the client's meetings (spec 3.5).
export const DomainPayload = z.object({
  domain: z.string().min(3).max(200),
  kind: z.enum(["CLIENT", "PARTNER"]),
  organizationName: z.string().max(200).nullish(),
});

/// Something to do, not to know (a promise made in the meeting, a document
/// to send): approving it opens a task on the client, not an item in the
/// file. No knowledge fields: a task is read by everyone on the client, so
/// nothing sensitive is ever proposed as one.
export const TaskPayload = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullish(),
  dueDate: day,
  /// Who at Ankora does it, by name. Nobody, or more than one person, is
  /// the person approving it.
  assigneeName: z.string().max(200).nullish(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).nullish(),
});

export const PAYLOADS = {
  FACT: FactPayload,
  CONTACT: ContactPayload,
  ORGANIZATION: OrganizationPayload,
  SYSTEM: SystemPayload,
  REQUEST_TYPE: RequestTypePayload,
  POLICY: PolicyPayload,
  ENTITY: EntityPayload,
  NARRATIVE: NarrativePayload,
  PROCESS: ProcessPayload,
  DOMAIN: DomainPayload,
  TASK: TaskPayload,
  DATE: DatePayload,
} as const;
export type ProposalTargetLike = keyof typeof PAYLOADS;
export type ProposalActionLike = "CREATE" | "SUPERSEDE" | "CONTRADICT";

export const TARGET_LABELS: Record<ProposalTargetLike, string> = {
  FACT: "עובדה",
  CONTACT: "איש קשר",
  ORGANIZATION: "ספק או נותן שירות",
  SYSTEM: "מערכת",
  REQUEST_TYPE: "סוג פנייה",
  POLICY: "כלל של הלקוח",
  ENTITY: "ישות משפטית",
  NARRATIVE: "סקירה, רקע או תפקידנו",
  PROCESS: "תהליך",
  DOMAIN: "דומיין",
  TASK: "משימה",
  DATE: "מועד",
};

export const ACTION_LABELS: Record<ProposalActionLike, string> = {
  CREATE: "חדש",
  SUPERSEDE: "גרסה חדשה לפריט קיים",
  CONTRADICT: "סותר פריט קיים",
};

/// `block`: approving it as it stands would break a rule that is not
/// waived (spec 5.2: "הפרה של כלל חובה: האישור חסום"). It can be edited
/// and approved, or rejected. Everything else is advice for the reviewer.
/// A sentence as a dictionary key (ADR 0006), resolved from the root of
/// messages/*.json by the review card (lib/knowledge-flag-words.ts). A
/// value may itself be a key, or a list joined with ", ".
export type FlagWords = { key: string; values?: Record<string, FlagWordsValue> };
export type FlagWordsValue = string | number | FlagWords | { join: (string | FlagWords)[] };
/// A flag's sentences as keys: what it says, and why it matters.
export type FlagSay = { message: FlagWords; why?: FlagWords };

export type ProposalFlag = {
  code: string;
  message: string;
  /// ADR 0006: `message` and `why` as keys, for the screen. Set on the
  /// problems said again when the card is read (proposalProblems); the
  /// flags stored with a proposal are recognised from their message
  /// (storedFlagSay). `message` stays the Hebrew Claude reads.
  say?: FlagSay;
  block?: boolean;
  /// Why the field is needed, in one sentence, so the reviewer knows what
  /// the missing part is for before completing it (3.11.2026).
  why?: string;
  /// A ready wording that completes the proposal: shown in full on the
  /// card, and approved with it in one press. `edits` are recomputed on the
  /// server from the proposal as stored, never taken from the browser.
  fix?: { label: string; edits: Record<string, unknown>; say?: FlagWords };
  /// The steps one flag stands for, when the same note applies to several.
  steps?: number[];
  /// SIMILAR, by name: the item in the file it may be, so the reviewer
  /// can add the proposal to it instead of a second item.
  match?: { id: string; name: string };
};

/// What stops a proposal from entering the file as it stands, found
/// without asking anybody (spec 5.2, 7.2). The same checks the file's own
/// functions make when it is written, said on the card before anyone
/// presses approve, and made again on the approved text after any edit:
/// - R17: a source code cited in the text that is not in the register.
/// - The item's own shape: temporary information without an end, a
///   one-off decision without a date, a proposed approval rule without
///   the interim rule that applies until it is approved.
/// A process enters as a draft, so what its procedure fails (R1, R3, R4)
/// is said here but does not block the proposal: it blocks the procedure's
/// approval, on the processes screen.
/// The approved wordings (Ariel, 3.11.2026).
export const SUGGESTED_INTERIM = "כמו היום, עד שהכלל מאושר.";
export const suggestedToResolve = (sourceTitle?: string | null) => (sourceTitle?.trim() ? `אישור מ${sourceTitle.trim()}.` : "אישור מהמקור של ההצעה.");
/// A long output would make a sentence nobody reads, and pass the field's
/// length: then the plain wording.
export const suggestedVerification = (output?: string | null) => (output?.trim() && output.trim().length <= 200 ? `אדם בודק ש${output.trim()} קיים.` : "אדם בודק שהשלב בוצע.");

/// "Already in the file", by kind of item (proposal-existing.ts says it).
export const DUPLICATE_MESSAGES: Record<string, string> = {
  FACT: "אותו פריט כבר קיים בתיק.",
  CONTACT: "איש קשר עם המייל או הטלפון הזה כבר בתיק.",
  ORGANIZATION: "הארגון כבר בתיק.",
  SYSTEM: "המערכת, באותו חשבון, כבר במפת המערכות.",
  ENTITY: "ישות בשם הזה כבר בתיק.",
  PROCESS: "תהליך בשם הזה כבר בתיק.",
  DATE: "מועד בשם הזה כבר אצל הלקוח.",
  DOMAIN: "הדומיין כבר בתיק.",
  POLICY: "כלל עם אותו שם או אותו נוסח כבר בתיק.",
};

/// The labels of the fields a missing-field note sends the reviewer to,
/// as the edit form on the review card shows them (ReviewBatch uses these
/// same words), so the note names the field the reviewer will see.
export const EDIT_FIELD_LABELS = {
  body: "מה",
  validUntilEvent: "בתוקף עד אירוע",
  decidedAt: "תאריך ההחלטה",
  interimStatement: "עד שיאושר",
  toResolve: "מה יסגור את זה",
  clientVisible: "גלוי ללקוח",
  date: "תאריך",
} as const;

/// "בעריכה, בשדה "X"": where the reviewer fills it in.
const inField = (label: string) => `בעריכה, בשדה "${label}"`;

type EditField = keyof typeof EDIT_FIELD_LABELS;
/// A key under knowledge.flags (ADR 0006).
const fw = (key: string, values?: FlagWords["values"]): FlagWords => ({ key: `knowledge.flags.${key}`, ...(values ? { values } : {}) });
const fieldWords = (field: EditField): FlagWords => fw(`fields.${field}`);

/// Which field completes a fact that fails its shape, by the same order
/// factShapeError checks it in.
function factShapeField(payload: Record<string, unknown>): EditField | null {
  if (typeof payload.body !== "string" || !payload.body.trim()) return "body";
  if (payload.kind === "TEMPORARY") return "validUntilEvent";
  if (payload.kind === "ONE_OFF_DECISION") return "decidedAt";
  return null;
}

/// A date is completed in the edit only when what it lacks is its day (a
/// one-off or annual date); a monthly or weekly day has no field there.
function dateShapeField(payload: Record<string, unknown>): EditField | null {
  return payload.recurrence === "ONCE" || payload.recurrence === "ANNUAL" ? "date" : null;
}

/// The sentence on the draft a process enters as, after a check.
const PROCESS_DRAFT = " (התהליך ייכנס כטיוטה, והנוהל לא יאושר עד שזה יתוקן.)";

/// The edit form has "מה יסגור את זה" for every item but a task, a date
/// and a question (a question is closed by its answer).
const hasToResolveField = (target: ProposalTargetLike, payload: Record<string, unknown>) => target !== "TASK" && target !== "DATE" && !(target === "FACT" && payload.kind === "QUESTION");

/// The codes proposalProblems says, so a stored card can be said again
/// with today's wording.
export const PROBLEM_CODES = ["R17", "SHAPE", "VISIBLE", "R1", "R2", "R3", "R4"];

export function proposalProblems(target: ProposalTargetLike, payload: Record<string, unknown>, registerCodes: string[], ctx: { sourceTitle?: string | null } = {}): ProposalFlag[] {
  const out: ProposalFlag[] = [];
  const known = new Set(registerCodes);
  const unknown = [...new Set(Object.values(payload).flatMap((v) => (typeof v === "string" ? citedCodes(v) : [])))].filter((c) => !known.has(c));
  if (unknown.length) {
    out.push({
      code: "R17",
      block: true,
      why: "כל פריט בתיק מפנה למקור שאפשר לפתוח, וקוד שלא במרשם הוא כנראה טעות הקלדה.",
      message: `הטקסט מצטט ${unknown.join(", ")}, ${unknown.length === 1 ? "שלא קיים" : "שלא קיימים"} במרשם המקורות של הלקוח. מתקנים את הקוד בעריכה, או דוחים.`,
      say: { message: fw("r17", { codes: unknown.join(", "), count: unknown.length }), why: fw("whyR17") },
    });
  }
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : null);
  if (target === "FACT") {
    const shape = factShapeError({ kind: payload.kind as never, body: s("body") ?? "", validUntil: s("validUntil") ? new Date(s("validUntil")!) : null, validUntilEvent: s("validUntilEvent"), decidedAt: s("decidedAt") ? new Date(s("decidedAt")!) : null });
    const why =
      payload.kind === "TEMPORARY"
        ? "בלי תאריך או אירוע שבו הוא נגמר, מידע זמני נשאר בתיק לתמיד."
        : payload.kind === "ONE_OFF_DECISION"
          ? "בלי תאריך אי אפשר לדעת אם ההחלטה עדיין בתוקף."
          : undefined;
    const field = factShapeField(payload);
    const problem = factShapeProblem({ kind: payload.kind as never, body: s("body") ?? "", validUntil: s("validUntil") ? new Date(s("validUntil")!) : null, validUntilEvent: s("validUntilEvent"), decidedAt: s("decidedAt") ? new Date(s("decidedAt")!) : null });
    const shapeWords: FlagWords = { key: "domainErrors.clientFacts.shape", values: { problem: problem ?? "other" } };
    if (shape) {
      out.push({
        code: "SHAPE",
        block: true,
        why,
        message: `${shape} משלימים ${field ? inField(EDIT_FIELD_LABELS[field]) : "בעריכה"}, או דוחים.`,
        say: {
          message: field ? fw("completeInField", { shape: shapeWords, field: fieldWords(field) }) : fw("completeInEdit", { shape: shapeWords }),
          why: payload.kind === "TEMPORARY" ? fw("whyTemporary") : payload.kind === "ONE_OFF_DECISION" ? fw("whyDecision") : undefined,
        },
      });
    }
  }
  if (target === "DATE") {
    const shape = dateShapeError(payload);
    const field = dateShapeField(payload);
    const problem = dateShapeProblem(payload);
    if (shape && problem) {
      const shapeWords = fw(`dateShape.${problem}`);
      out.push({
        code: "SHAPE",
        block: true,
        why: "בלי היום שבו המועד חל, המערכת לא יודעת מתי להזכיר.",
        message: field ? `${shape} משלימים ${inField(EDIT_FIELD_LABELS[field])}, או דוחים.` : `${shape} לזה אין שדה בעריכה: דוחים, ומבקשים מ-Claude לשלוח את המועד שוב עם היום.`,
        say: {
          message: field ? fw("completeInField", { shape: shapeWords, field: fieldWords(field) }) : fw("dateNoField", { shape: shapeWords }),
          why: fw("whyDate"),
        },
      });
    }
  }
  if (target === "POLICY" && NEEDS_INTERIM.includes(payload.kind as PolicyKindLike) && !s("interimStatement")?.trim()) {
    out.push({
      code: "SHAPE",
      block: true,
      why: "כלל מוצע לא חל עד שמאשרים אותו, ולכן צריך לכתוב מה עושים בינתיים.",
      message: `חסר כלל ביניים: מה עושים עד שהכלל מאושר. משלימים בנוסח המוצע, או ${inField(EDIT_FIELD_LABELS.interimStatement)}, או דוחים.`,
      // The suggested wording is what goes into the file, so it is shown
      // as it will be written, in any language.
      fix: { label: SUGGESTED_INTERIM, edits: { interimStatement: SUGGESTED_INTERIM } },
      say: { message: fw("interimMissing", { field: fieldWords("interimStatement") }), why: fw("whyInterim") },
    });
  }
  // Rule 1: anything short of confirmed says what would confirm it.
  // Not an open question: what closes it is its answer, and the file
  // writes that on its own (client-facts.ts). Its edit had no such field,
  // so a question from a meeting could not be approved at all (3.11.2026).
  if (!(target === "FACT" && payload.kind === "QUESTION") && (payload.knowledgeStatus === "UNCERTAIN" || payload.knowledgeStatus === "MISSING") && !s("toResolve")?.trim()) {
    const toResolve = suggestedToResolve(ctx.sourceTitle);
    out.push({
      code: "SHAPE",
      block: true,
      why: "בלי זה אף אחד לא יודע איך מאמתים את הפריט, והוא נשאר לא ודאי לתמיד.",
      message: `סומן לא ודאי או חסר, ולא כתוב מה יאמת אותו. משלימים בנוסח המוצע${hasToResolveField(target, payload) ? `, או ${inField(EDIT_FIELD_LABELS.toResolve)}` : ""}, או דוחים.`,
      fix: { label: toResolve, edits: { toResolve } },
      say: {
        message: hasToResolveField(target, payload) ? fw("toResolveMissingField", { field: fieldWords("toResolve") }) : fw("toResolveMissing"),
        why: fw("whyToResolve"),
      },
    });
  }
  // Spec 3.1: shown to the client only when nothing forbids it.
  if (payload.clientVisible === true) {
    const why = clientVisibleBlocker({ sensitivity: s("sensitivity"), doNotDisclose: s("doNotDisclose") });
    if (why) {
      out.push({
        code: "VISIBLE",
        block: true,
        why: "הלקוח רואה בפורטל רק פריט שאין סיבה להסתיר ממנו.",
        message: `${why} מורידים את "גלוי ללקוח" בנוסח המוצע, או ${inField(EDIT_FIELD_LABELS.clientVisible)} בוחרים "לא", או דוחים.`,
        fix: { label: 'בלי "גלוי ללקוח"', edits: { clientVisible: false }, say: fw("withoutVisible") },
        say: {
          message: fw("visible", { reason: fw(s("sensitivity") === "SENSITIVE" ? "notShown.sensitive" : "notShown.doNotDisclose"), field: fieldWords("clientVisible") }),
          why: fw("whyVisible"),
        },
      });
    }
  }
  if (target === "PROCESS" && Array.isArray(payload.steps) && payload.steps.length) {
    const draft = PROCESS_DRAFT;
    const checks = blockingChecks({ steps: readSteps(payload.steps) }, []);
    // R3 on several steps is one line with the steps, not one per step
    // (3.11.2026: five identical lines said nothing the first did not).
    const r3 = checks.filter((c) => c.code === "R3" && c.step);
    for (const c of checks.filter((c) => !(c.code === "R3" && c.step))) {
      const k = c.keyed;
      const check: FlagWordsValue = k
        ? {
            key: `clients.processes.checks.${k.key}`,
            values: {
              step: k.step ?? "",
              tags: { join: (k.tags ?? []).map((x) => ({ key: `clients.processes.labels.actionTags.${x}` })) },
              thresholds: (k.thresholds ?? []).join(", "),
              secrets: { join: (k.secrets ?? []).map((x) => ({ key: `clients.processes.labels.secrets.${x}` })) },
            },
          }
        : c.message;
      out.push({ code: c.code, message: `${c.message}${draft}`, say: { message: fw("processCheck", { check }) } });
    }
    if (r3.length) {
      const steps = r3.map((c) => c.step!);
      const edits = {
        steps: (payload.steps as unknown[]).map((raw) => {
          if (!raw || typeof raw !== "object") return raw;
          const st = raw as Record<string, unknown>;
          if (st.mode !== "AUTOMATED" || (typeof st.verification === "string" && st.verification.trim())) return raw;
          return { ...st, verification: suggestedVerification(typeof st.output === "string" ? st.output : null) };
        }),
      };
      out.push({
        code: "R3",
        steps,
        why: "פעולה אוטומטית יכולה להיכשל בשקט, ולכן אדם צריך דרך לבדוק שהיא קרתה.",
        // The review's edit has no steps: the procedure's editor has the
        // field, on the process, once it is in the file.
        message: `${automatedStepsMessage(steps)} משלימים בנוסח המוצע, או אחרי האישור בנוהל של התהליך, ${steps.length === 1 ? "בשלב" : "בכל שלב"} בשדה "${VERIFICATION_FIELD_LABEL}".${draft}`,
        say: {
          message: fw("r3", {
            count: steps.length,
            steps:
              steps.length === 1
                ? { key: "clients.processes.checks.automatedNoVerification", values: { step: steps[0] } }
                : fw("automatedSteps", { steps: steps.slice(0, -1).join(", "), last: String(steps[steps.length - 1]) }),
          }),
          why: fw("whyR3"),
        },
        // The wording in full, step by step, before anyone presses.
        fix: { label: readSteps(payload.steps).flatMap((st, i) => (steps.includes(i + 1) ? [`שלב ${i + 1}: ${suggestedVerification(st.output)}`] : [])).join(" "), edits },
      });
    }
  }
  return out;
}

/// Every suggested wording on a proposal together, or null when a problem
/// that blocks approval has none: then only the edit can complete it.
export function suggestedFix(flags: ProposalFlag[]): Record<string, unknown> | null {
  const fixes = flags.filter((f) => f.fix);
  if (fixes.length === 0) return null;
  if (flags.some((f) => f.block && !f.fix)) return null;
  return Object.assign({}, ...fixes.map((f) => f.fix!.edits));
}

/// The most proposals decided in one action.
export const MAX_BULK = 60;

/// Why a proposal is decided on its own and not approved with others, or
/// null when it may be. Approving together is still a person approving on
/// the screen (decision 1); what stays one at a time is what the approval
/// tiers put there (approvalTier, INDIVIDUAL): what changes an item
/// already in the file, what may already be there, what is sensitive or
/// shown to the client, a task (it opens work for someone), a domain, and
/// anything the review reads as low. Rejecting together is always
/// allowed: nothing enters the file.
export function bulkApproveBlocker(p: TierInput): string | null {
  const t = approvalTier(p);
  return t.tier === "INDIVIDUAL" ? t.reason : null;
}

// ---------------------------------------------------------------------------
// Approval tiers (3.11.2026, the approved procedure for extraction
// approvals): what may enter on its own, what may be approved together,
// and what is approved one at a time.
// ---------------------------------------------------------------------------

export type ApprovalTier = "AUTO" | "QUICK" | "INDIVIDUAL";

export type TierInput = {
  target: ProposalTargetLike;
  action: ProposalActionLike;
  flags: ProposalFlag[];
  payload: Record<string, unknown>;
  /// reviewConfidence(...).level, as the card shows it.
  level: ConfidenceLike;
};

/// The kinds of fact that are simple enough to enter on their own: what
/// the client said, with nothing to answer (a question) and nothing that
/// runs out (temporary information).
export const AUTO_FACT_KINDS = ["NOTE", "PREFERENCE", "REQUIREMENT", "FINANCE", "LOCATION", "SCOPE_IN", "SCOPE_OUT", "ONE_OFF_DECISION"] as const;

/// The items an approval may create on its own, and the only ones a
/// "ביטול" takes out again (revertBlocker): each has a soft delete.
export const AUTO_TARGETS: readonly ProposalTargetLike[] = ["FACT", "CONTACT", "ORGANIZATION", "ENTITY"] as const;

/// A new item of a simple kind: a fact of one of AUTO_FACT_KINDS, a
/// contact, a provider or an entity.
export function isSimpleTarget(target: ProposalTargetLike, payload: Record<string, unknown>): boolean {
  if (target === "FACT") return (AUTO_FACT_KINDS as readonly string[]).includes(String(payload.kind));
  return AUTO_TARGETS.includes(target);
}

/// The tier a proposal is in, with the reason in a short Hebrew line.
/// INDIVIDUAL is checked first and wins: one reason to look is enough.
export function approvalTier(p: TierInput): { tier: ApprovalTier; reason: string } {
  const { tier, reason } = tierOf(p);
  return { tier, reason };
}

/// Why a proposal is in its tier, as a code a screen words in the
/// reader's language (ADR 0006). approvalTier's `reason` is the same in
/// Hebrew, for Claude and the tests.
export type TierReasonCode =
  | "blocked"
  | "changesExisting"
  | "maybeInFile"
  | "sensitive"
  | "doNotDisclose"
  | "clientVisible"
  | "taskForOther"
  | "domain"
  | "lowLevel"
  | "simpleHigh"
  | "medium"
  | "openQuestion"
  | "temporary"
  | "needsPerson";

function tierOf(p: TierInput): { tier: ApprovalTier; reason: string; code: TierReasonCode } {
  const one = (code: TierReasonCode, reason: string) => ({ tier: "INDIVIDUAL" as const, reason, code });
  if (p.flags.some((f) => f.block)) return one("blocked", "יש בה משהו שחוסם אישור");
  if (p.action !== "CREATE") return one("changesExisting", "משנה פריט שכבר בתיק");
  if (p.flags.some((f) => f.code === "DUPLICATE" || f.code === "SIMILAR")) return one("maybeInFile", "ייתכן שכבר בתיק");
  if (p.flags.some((f) => f.code === "R6") || p.payload.sensitivity === "SENSITIVE") return one("sensitive", "מידע רגיש");
  if (typeof p.payload.doNotDisclose === "string" && p.payload.doNotDisclose.trim()) return one("doNotDisclose", "יש בה מה לא לספר");
  if (p.payload.clientVisible === true) return one("clientVisible", "גלוי ללקוח");
  if (p.target === "TASK") return one("taskForOther", "משימה נפתחת לאדם אחר");
  if (p.target === "DOMAIN") return one("domain", "דומיין משנה אילו פגישות שייכות ללקוח");
  if (p.level === "LOW") return one("lowLevel", "רמת בדיקה נמוכה");
  const simple = isSimpleTarget(p.target, p.payload);
  if (simple && p.level === "HIGH") return { tier: "AUTO", reason: "פריט חדש ופשוט, ברמת בדיקה גבוהה", code: "simpleHigh" };
  if (simple) return { tier: "QUICK", reason: "רמת בדיקה בינונית", code: "medium" };
  if (p.target === "FACT" && p.payload.kind === "QUESTION") return { tier: "QUICK", reason: "שאלה פתוחה", code: "openQuestion" };
  if (p.target === "FACT" && p.payload.kind === "TEMPORARY") return { tier: "QUICK", reason: "מידע זמני", code: "temporary" };
  return { tier: "QUICK", reason: `${TARGET_LABELS[p.target]}: לא נכנס בלי אדם`, code: "needsPerson" };
}

/// bulkApproveBlocker as a code (ADR 0006), or null when it may be
/// approved with others.
export function bulkApproveBlockerCode(p: TierInput): TierReasonCode | null {
  const t = tierOf(p);
  return t.tier === "INDIVIDUAL" ? t.code : null;
}

/// Why the item an approved proposal created cannot be taken out again
/// with "ביטול", or null when it can. Only a new item of the kinds an
/// approval may create on its own, that the approval itself created (not
/// "כבר בתיק"), and only once.
export function revertBlocker(p: {
  state: string;
  action: string;
  target: string;
  attached: boolean;
  resultId: string | null;
  revertedAt: Date | string | null;
}): string | null {
  return revertBlockerOf(p)?.message ?? null;
}

export type RevertBlockerCode = "notApproved" | "alreadyReverted" | "notCreate" | "nothingCreated" | "wrongKind";

/// revertBlocker with its code (ADR 0006): the screen words the code, the
/// message stays for Claude and for callers that already show it.
export function revertBlockerOf(p: Parameters<typeof revertBlocker>[0]): { code: RevertBlockerCode; message: string } | null {
  if (p.state !== "APPROVED") return { code: "notApproved", message: "אפשר לבטל רק הצעה שאושרה." };
  if (p.revertedAt) return { code: "alreadyReverted", message: "ההצעה כבר בוטלה." };
  if (p.action !== "CREATE") return { code: "notCreate", message: "ביטול אפשרי רק להצעה שהוסיפה פריט חדש, לא לשינוי של פריט קיים." };
  if (p.attached || !p.resultId) return { code: "nothingCreated", message: "ההצעה לא יצרה פריט חדש (כבר היה בתיק), אז אין מה לבטל." };
  if (!AUTO_TARGETS.includes(p.target as ProposalTargetLike)) return { code: "wrongKind", message: `ביטול אפשרי רק לעובדה, איש קשר, ספק או ישות משפטית, לא ל${TARGET_LABELS[p.target as ProposalTargetLike] ?? "פריט מהסוג הזה"}.` };
  return null;
}

// ---------------------------------------------------------------------------
// Reviewing fast (spec 5.2: a normal batch in under five minutes)
// ---------------------------------------------------------------------------

/// Items that carry the knowledge fields (spec 3.1). A free text and a
/// domain are not "confirmed" or "uncertain": they are only approved.
const HAS_STATUS: ProposalTargetLike[] = ["FACT", "CONTACT", "ORGANIZATION", "SYSTEM", "REQUEST_TYPE", "POLICY", "ENTITY", "PROCESS"];

/// What a proposal must say before anyone reads it, or null. Refused when
/// it arrives, with this line back to Claude: the reviewer should never
/// have to guess why, or how sure.
export function missingRequired(target: ProposalTargetLike, payload: Record<string, unknown>, reason: string | null | undefined, path = "items[i]"): string | null {
  if (!reason?.trim()) return `חסרה סיבה ב-${path}.reason: משפט אחד, למה זה נכון ומאיפה.`;
  if (needsStatus(target, payload) && !payload.knowledgeStatus) return `חסר סטטוס ב-${path}.status: CONFIRMED, UNCERTAIN או MISSING.`;
  return null;
}

export const KNOWLEDGE_STATUSES = ["CONFIRMED", "UNCERTAIN", "MISSING"] as const;
export type KnowledgeStatusInput = (typeof KNOWLEDGE_STATUSES)[number];

/// Whether an item carries a knowledge status at all: a question is not
/// "confirmed", and a task, a date, a free text and a domain are only
/// approved.
export function needsStatus(target: ProposalTargetLike, payload: Record<string, unknown>): boolean {
  return HAS_STATUS.includes(target) && !(target === "FACT" && payload.kind === "QUESTION");
}

/// 31.10.2026: the status an item says nothing about, read from how sure
/// Claude is. Only HIGH is confirmed; MISSING is never guessed.
export function statusFromConfidence(confidence: string | null | undefined): KnowledgeStatusInput {
  return confidence === "HIGH" ? "CONFIRMED" : "UNCERTAIN";
}

/// The item's status, wherever it was sent, written to
/// `payload.knowledgeStatus` where the rest of the server reads it.
///
/// 31.10.2026: the tool's input schema had no status field, and the
/// description said `payload.knowledgeStatus` only near its end, which
/// clients cut off. A `status` sent on the item was stripped by zod
/// before it got here, and one sent in the payload was not the name read,
/// so every item came back "חסר סטטוס". Now it is read from
/// `payload.knowledgeStatus`, `status` on the item, or `status` in the
/// payload, and when none is sent it comes from `confidence`.
export function resolveKnowledgeStatus(
  item: { target: ProposalTargetLike; payload: Record<string, unknown>; status?: unknown; confidence?: string | null },
  path = "items[i]"
): { ok: true; payload: Record<string, unknown>; defaulted: boolean } | { ok: false; reason: string } {
  const payload = { ...(item.payload ?? {}) };
  if (!needsStatus(item.target, payload)) return { ok: true, payload, defaulted: false };
  const sent: { where: string; value: unknown }[] = [
    { where: `${path}.payload.knowledgeStatus`, value: payload.knowledgeStatus },
    { where: `${path}.status`, value: item.status },
    { where: `${path}.payload.status`, value: payload.status },
  ].filter((s) => s.value !== undefined && s.value !== null && s.value !== "");
  delete payload.status;
  for (const s of sent) {
    if (!KNOWLEDGE_STATUSES.includes(s.value as KnowledgeStatusInput)) {
      return { ok: false, reason: `סטטוס לא תקין ב-${s.where}: "${String(s.value)}". הערכים האפשריים: CONFIRMED, UNCERTAIN או MISSING.` };
    }
  }
  const values = [...new Set(sent.map((s) => s.value as KnowledgeStatusInput))];
  if (values.length > 1) {
    return { ok: false, reason: `סטטוסים סותרים ב-${sent.map((s) => s.where).join(" וב-")}: ${values.join(", ")}. שולחים סטטוס אחד, ב-${path}.status.` };
  }
  if (values.length === 1) return { ok: true, payload: { ...payload, knowledgeStatus: values[0] }, defaulted: false };
  return { ok: true, payload: { ...payload, knowledgeStatus: statusFromConfidence(item.confidence) }, defaulted: true };
}

export type ConfidenceLike = "HIGH" | "MEDIUM" | "LOW";
export const CONFIDENCE_LEVELS: readonly ConfidenceLike[] = ["HIGH", "MEDIUM", "LOW"] as const;
export const CONFIDENCE_LABELS: Record<ConfidenceLike, string> = { HIGH: "ביטחון גבוה", MEDIUM: "ביטחון בינוני", LOW: "ביטחון נמוך" };

const lower = (c: ConfidenceLike): ConfidenceLike => (c === "HIGH" ? "MEDIUM" : "LOW");

/// How sure the proposal is, as the reviewer should read it: what Claude
/// said (medium when it said nothing), one level lower for each thing the
/// server can see that weakens it. With the reasons, so a lower level is
/// never a mystery.
export function reviewConfidence(p: {
  confidence?: string | null;
  flags: ProposalFlag[];
  payload: Record<string, unknown>;
  /// The recording minute, when there is one.
  at?: string | null;
  sourceKind?: string | null;
  sourceRestriction?: string | null;
}): { level: ConfidenceLike; why: string[] } {
  const { level, why } = confidenceOf(p);
  return { level, why };
}

/// Why reviewConfidence lowered the level, as codes a screen words in the
/// reader's language (ADR 0006), in the order of `why`.
export type ConfidenceReasonCode = "notStated" | "noMinute" | "topicsOnly" | "secondary" | "uncertain";

export function reviewConfidenceReasons(p: Parameters<typeof reviewConfidence>[0]): ConfidenceReasonCode[] {
  return confidenceOf(p).reasons;
}

function confidenceOf(p: Parameters<typeof reviewConfidence>[0]): { level: ConfidenceLike; why: string[]; reasons: ConfidenceReasonCode[] } {
  let level: ConfidenceLike = CONFIDENCE_LEVELS.includes(p.confidence as ConfidenceLike) ? (p.confidence as ConfidenceLike) : "MEDIUM";
  const why: string[] = [];
  const reasons: ConfidenceReasonCode[] = [];
  const add = (code: ConfidenceReasonCode, line: string) => {
    reasons.push(code);
    why.push(line);
  };
  if (!p.confidence) add("notStated", "Claude לא ציין עד כמה הוא בטוח");
  if (p.sourceKind === "TRANSCRIPT" && !p.at) {
    level = lower(level);
    add("noMinute", "בלי דקה בהקלטה");
  }
  if (p.sourceRestriction === "TOPICS_ONLY") {
    level = lower(level);
    add("topicsOnly", "מקור של נושאים בלבד");
  }
  if (p.flags.some((f) => f.code === "R14")) {
    level = lower(level);
    add("secondary", "מקור משני");
  }
  if (p.payload.knowledgeStatus === "UNCERTAIN" || p.payload.knowledgeStatus === "MISSING") {
    level = lower(level);
    add("uncertain", "לא ודאי לפי Claude");
  }
  return { level, why, reasons };
}

/// reviewConfidence's level for a stored proposal and its batch's source:
/// the recording minute is read from the proposal's first source.
export function proposalReviewLevel(
  p: { confidence: string | null; flags: ProposalFlag[]; payload: Record<string, unknown> },
  source: { kind: string | null; restriction: string | null } | null
): ConfidenceLike {
  const at = readSourceRefs(p.payload.sources)[0]?.at ?? null;
  return reviewConfidence({ confidence: p.confidence, flags: p.flags, payload: p.payload, at, sourceKind: source?.kind ?? null, sourceRestriction: source?.restriction ?? null }).level;
}

/// The order on the card: what stops approval first, then what is decided
/// one at a time, then by how sure it is. The easy ones end up together at
/// the bottom, to be approved in one go.
export function reviewRank(p: TierInput): number {
  if (p.flags.some((f) => f.block)) return 0;
  // One at a time, a low review level among them (approvalTier).
  if (bulkApproveBlocker(p)) return 1;
  return p.level === "MEDIUM" ? 3 : 4;
}

/// The line on top of a card: how much of it can go together.
export function reviewSummary(ranks: number[]): string | null {
  if (ranks.length === 0) return null;
  const together = ranks.filter((r) => r >= 2).length;
  const alone = ranks.length - together;
  if (alone === 0) return together === 1 ? "הצעה אחת, אפשר לאשר ישר." : `אפשר לאשר את כל ה-${together} יחד.`;
  if (together === 0) return alone === 1 ? "הצעה אחת לבדוק לבד." : `${alone} הצעות לבדוק אחת אחת.`;
  return `${alone === 1 ? "אחת לבדוק לבד" : `${alone} לבדוק אחת אחת`}, ${together === 1 ? "ואחת אפשר לאשר יחד" : `ו-${together} אפשר לאשר יחד`}.`;
}

/// reviewSummary's numbers, for a screen that words them in the reader's
/// language (ADR 0006): how many are read alone, how many go together.
export function reviewSummaryCounts(ranks: number[]): { alone: number; together: number } | null {
  if (ranks.length === 0) return null;
  const together = ranks.filter((r) => r >= 2).length;
  return { alone: ranks.length - together, together };
}

/// The line a proposal is known by, on its card and in a list.
export function proposalHeadline(target: ProposalTargetLike, payload: Record<string, unknown>): string {
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  switch (target) {
    case "FACT":
      return s("body");
    case "CONTACT":
      return [s("name"), s("role")].filter(Boolean).join(", ");
    case "ORGANIZATION":
      return [s("name"), s("role")].filter(Boolean).join(", ");
    case "REQUEST_TYPE":
      return [s("title"), s("handling")].filter(Boolean).join(": ");
    case "POLICY":
      return [s("title"), s("statement")].filter(Boolean).join(": ");
    case "SYSTEM":
      return [s("systemName"), s("purpose")].filter(Boolean).join(", ");
    case "ENTITY":
      return [s("name"), s("legalName")].filter(Boolean).join(", ");
    case "NARRATIVE":
      return s("body").length > 160 ? `${s("body").slice(0, 157)}...` : s("body");
    case "PROCESS":
      return [s("title"), s("purpose")].filter(Boolean).join(": ");
    case "DOMAIN":
      return [s("domain"), s("organizationName")].filter(Boolean).join(", ");
    case "TASK":
      return s("title");
    case "DATE":
      return [s("title"), dateWhen(payload)].filter(Boolean).join(": ");
  }
}

/// What a reviewer needs beyond the headline to decide: a process's steps,
/// an entity's identifiers, the whole of a long text. Empty for the rest.
function refsDetail(v: unknown): string {
  const refs = readExternalRefs(v).map(refLabel);
  return refs.length ? `הפניות: ${refs.join(", ")}` : "";
}

export function proposalDetails(target: ProposalTargetLike, payload: Record<string, unknown>): string[] {
  // Spec 3.1, on every kind of item.
  const common = [...linkDetails(payload), payload.clientVisible === true ? "גלוי ללקוח" : "", typeof payload.ownerName === "string" && payload.ownerName.trim() ? `בעלים: ${payload.ownerName.trim()}` : "", refsDetail(payload.externalRefs)].filter(Boolean);
  return [...itemDetails(target, payload), ...common];
}

/// What the proposal names in the file, as the reviewer reads it. Linked
/// when approved (lib/app-domain/proposal-links.ts).
export function linkDetails(payload: Record<string, unknown>): string[] {
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string).trim() : "");
  const l = (k: string) => (Array.isArray(payload[k]) ? (payload[k] as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
  const CYCLE: Record<string, string> = { MONTHLY: "חודשי", ANNUAL: "שנתי", OTHER: "אחר" };
  const cost = typeof payload.billingCostMinor === "number" ? `${(payload.billingCostMinor / 100).toLocaleString("he-IL")} ${s("billingCurrency")}`.trim() : "";
  return [
    s("entityName") && `ישות: ${s("entityName")}`,
    s("subjectName") && `של: ${s("subjectName")}`,
    l("routeToNames").length > 0 && `מפנים אל: ${l("routeToNames").join(", ")}`,
    s("processName") && `מפעיל את: ${s("processName")}`,
    l("externalPartyNames").length > 0 && `גורם חיצוני: ${l("externalPartyNames").join(", ")}`,
    l("systemNames").length > 0 && `מערכות: ${l("systemNames").join(", ")}`,
    s("approverName") && `מאשר: ${s("approverName")}`,
    l("approvalPolicyTitles").length > 0 && `כללי אישור: ${l("approvalPolicyTitles").join(", ")}`,
    (s("billingCycle") || cost) && `חיוב: ${[CYCLE[s("billingCycle")] ?? "", cost, s("cardLast4") && `כרטיס ${s("cardLast4")}`].filter(Boolean).join(", ")}`,
    s("invoiceTo") && `חשבונית אל: ${s("invoiceTo")}`,
  ].filter((x): x is string => !!x);
}

function itemDetails(target: ProposalTargetLike, payload: Record<string, unknown>): string[] {
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  if (target === "TASK") {
    const PRIORITY: Record<string, string> = { LOW: "נמוכה", NORMAL: "רגילה", HIGH: "גבוהה", URGENT: "דחופה" };
    return [
      s("description"),
      s("dueDate") && `תאריך יעד: ${s("dueDate")}`,
      s("assigneeName") && `אחראי: ${s("assigneeName")}`,
      s("priority") && s("priority") !== "NORMAL" && `עדיפות: ${PRIORITY[s("priority")] ?? s("priority")}`,
    ].filter((x): x is string => !!x);
  }
  if (target === "PROCESS") {
    const steps = Array.isArray(payload.steps) ? (payload.steps as { title?: unknown; requiresApproval?: unknown }[]) : [];
    return [
      s("triggerText") && `מה מפעיל: ${s("triggerText")}`,
      s("slaText") && `SLA: ${s("slaText")}`,
      ...steps.map((st, i) => `${i + 1}. ${typeof st.title === "string" ? st.title : ""}${st.requiresApproval ? " (דורש אישור)" : ""}${Array.isArray((st as { systemNames?: unknown }).systemNames) && ((st as { systemNames: unknown[] }).systemNames).length ? ` [${((st as { systemNames: unknown[] }).systemNames).join(", ")}]` : ""}`),
    ].filter((x): x is string => !!x);
  }
  if (target === "DATE") {
    const days = typeof payload.taskDaysBefore === "number" ? payload.taskDaysBefore : null;
    return [
      s("conditionText") && `בתנאי: ${s("conditionText")}`,
      payload.expectsReceipt === true && `ממתין לקבלה${s("expectedFrom") ? ` מ-${s("expectedFrom")}` : ""}`,
      s("ifNotBusinessDay") && (s("ifNotBusinessDay") === "BEFORE" ? "ביום עסקים לפני, אם נופל על יום חופש" : "ביום העסקים הבא, אם נופל על יום חופש"),
      s("responsibleName") && `אחראי: ${s("responsibleName")}`,
      days !== null && `משימה ${days === 0 ? "ביום עצמו" : `${days} ימים לפני`}`,
      s("notes"),
    ].filter((x): x is string => !!x);
  }
  if (target === "ENTITY") {
    return [s("registrationNumber"), s("country"), s("currency"), s("parentName") && `בת של ${s("parentName")}`].filter((x): x is string => !!x);
  }
  if (target === "POLICY") return [s("effectiveFrom") && `נכנס לתוקף ב-${s("effectiveFrom")}`, s("reviewBy") && `לסקירה עד ${s("reviewBy")}`].filter((x): x is string => !!x);
  if (target === "NARRATIVE") return s("body").length > 160 ? [s("body")] : [];
  if (target === "DOMAIN") return [payload.kind === "PARTNER" ? "דומיין של שותף" : "דומיין של הלקוח"];
  return [];
}

/// proposalDetails as parts a screen words in the reader's language
/// (ADR 0006): a key with its values, or text people or Claude wrote,
/// shown as it is. The same lines, in the same order.
export type DetailKey =
  | "refs"
  | "clientVisible"
  | "owner"
  | "entity"
  | "subject"
  | "routeTo"
  | "triggersProcess"
  | "externalParty"
  | "systems"
  | "approver"
  | "approvalPolicies"
  | "invoiceTo"
  | "dueDate"
  | "assignee"
  | "trigger"
  | "sla"
  | "condition"
  | "expectsReceipt"
  | "expectsReceiptFrom"
  | "businessDayBefore"
  | "businessDayAfter"
  | "responsible"
  | "taskSameDay"
  | "taskDaysBefore"
  | "parent"
  | "effectiveFrom"
  | "reviewBy"
  | "partnerDomain"
  | "clientDomain";

export type DetailPart =
  | { kind: "key"; key: DetailKey; values?: Record<string, string | number> }
  | { kind: "text"; text: string }
  /// "חיוב: חודשי, 120 USD, כרטיס 1234": the cycle a code, the amount a number.
  | { kind: "billing"; cycle: string; amount: number | null; currency: string; cardLast4: string }
  | { kind: "priority"; priority: string }
  | { kind: "step"; n: number; title: string; requiresApproval: boolean; systems: string[] };

export function proposalDetailParts(target: ProposalTargetLike, payload: Record<string, unknown>): DetailPart[] {
  const key = (k: DetailKey, values?: Record<string, string | number>): DetailPart => ({ kind: "key", key: k, ...(values ? { values } : {}) });
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  const st = (k: string) => s(k).trim();
  const l = (k: string) => (Array.isArray(payload[k]) ? (payload[k] as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
  const text = (t: string): DetailPart[] => (t ? [{ kind: "text", text: t }] : []);
  const items: DetailPart[] = [];
  if (target === "TASK") {
    items.push(...text(s("description")));
    if (s("dueDate")) items.push(key("dueDate", { date: s("dueDate") }));
    if (s("assigneeName")) items.push(key("assignee", { name: s("assigneeName") }));
    if (s("priority") && s("priority") !== "NORMAL") items.push({ kind: "priority", priority: s("priority") });
  } else if (target === "PROCESS") {
    const steps = Array.isArray(payload.steps) ? (payload.steps as { title?: unknown; requiresApproval?: unknown; systemNames?: unknown }[]) : [];
    if (s("triggerText")) items.push(key("trigger", { text: s("triggerText") }));
    if (s("slaText")) items.push(key("sla", { text: s("slaText") }));
    steps.forEach((step, i) =>
      items.push({
        kind: "step",
        n: i + 1,
        title: typeof step.title === "string" ? step.title : "",
        requiresApproval: !!step.requiresApproval,
        systems: Array.isArray(step.systemNames) ? step.systemNames.map(String) : [],
      })
    );
  } else if (target === "DATE") {
    const days = typeof payload.taskDaysBefore === "number" ? payload.taskDaysBefore : null;
    if (s("conditionText")) items.push(key("condition", { text: s("conditionText") }));
    if (payload.expectsReceipt === true) items.push(s("expectedFrom") ? key("expectsReceiptFrom", { from: s("expectedFrom") }) : key("expectsReceipt"));
    if (s("ifNotBusinessDay")) items.push(key(s("ifNotBusinessDay") === "BEFORE" ? "businessDayBefore" : "businessDayAfter"));
    if (s("responsibleName")) items.push(key("responsible", { name: s("responsibleName") }));
    if (days !== null) items.push(days === 0 ? key("taskSameDay") : key("taskDaysBefore", { days: String(days) }));
    items.push(...text(s("notes")));
  } else if (target === "ENTITY") {
    items.push(...text(s("registrationNumber")), ...text(s("country")), ...text(s("currency")));
    if (s("parentName")) items.push(key("parent", { name: s("parentName") }));
  } else if (target === "POLICY") {
    if (s("effectiveFrom")) items.push(key("effectiveFrom", { date: s("effectiveFrom") }));
    if (s("reviewBy")) items.push(key("reviewBy", { date: s("reviewBy") }));
  } else if (target === "NARRATIVE") {
    if (s("body").length > 160) items.push({ kind: "text", text: s("body") });
  } else if (target === "DOMAIN") {
    items.push(key(payload.kind === "PARTNER" ? "partnerDomain" : "clientDomain"));
  }

  const links: DetailPart[] = [];
  if (st("entityName")) links.push(key("entity", { name: st("entityName") }));
  if (st("subjectName")) links.push(key("subject", { name: st("subjectName") }));
  if (l("routeToNames").length > 0) links.push(key("routeTo", { names: l("routeToNames").join(", ") }));
  if (st("processName")) links.push(key("triggersProcess", { name: st("processName") }));
  if (l("externalPartyNames").length > 0) links.push(key("externalParty", { names: l("externalPartyNames").join(", ") }));
  if (l("systemNames").length > 0) links.push(key("systems", { names: l("systemNames").join(", ") }));
  if (st("approverName")) links.push(key("approver", { name: st("approverName") }));
  if (l("approvalPolicyTitles").length > 0) links.push(key("approvalPolicies", { titles: l("approvalPolicyTitles").join(", ") }));
  const amount = typeof payload.billingCostMinor === "number" ? payload.billingCostMinor / 100 : null;
  if (st("billingCycle") || amount !== null) links.push({ kind: "billing", cycle: st("billingCycle"), amount, currency: st("billingCurrency"), cardLast4: st("cardLast4") });
  if (st("invoiceTo")) links.push(key("invoiceTo", { name: st("invoiceTo") }));

  const common: DetailPart[] = [...links];
  if (payload.clientVisible === true) common.push(key("clientVisible"));
  if (typeof payload.ownerName === "string" && payload.ownerName.trim()) common.push(key("owner", { name: payload.ownerName.trim() }));
  const refs = readExternalRefs(payload.externalRefs).map(refLabel);
  if (refs.length) common.push(key("refs", { refs: refs.join(", ") }));
  return [...items, ...common];
}

/// qualityLine's numbers, for a screen that words them in the reader's
/// language (ADR 0006). `kind` is which sentence; `monthEnds` is set for
/// "firstMonth" only.
export function qualityParts(
  q: { approved: number; editedBeforeApproval: number; rejected: number; firstDecidedAt: Date | null },
  now: Date
): { kind: "none" | "firstMonth" | "good" | "warn"; tone: "neutral" | "good" | "warn"; days: number; approved: number; edited: number; pct: number; rejected: number; monthEnds: Date | null } {
  const share = q.approved ? q.editedBeforeApproval / q.approved : 0;
  const base = { days: DECISION_1_DAYS, approved: q.approved, edited: q.editedBeforeApproval, pct: Math.round(share * 1000) / 10, rejected: q.rejected, monthEnds: null as Date | null };
  if (q.approved === 0 && q.rejected === 0) return { ...base, kind: "none", tone: "neutral" };
  const monthEnds = q.firstDecidedAt ? new Date(q.firstDecidedAt.getTime() + DECISION_1_DAYS * 86_400_000) : null;
  if (monthEnds && monthEnds.getTime() > now.getTime()) return { ...base, kind: "firstMonth", tone: "neutral", monthEnds };
  return share < DECISION_1_LIMIT ? { ...base, kind: "good", tone: "good" } : { ...base, kind: "warn", tone: "warn" };
}

/// Decision 1: after the first month, if fewer than 10% of approved
/// proposals were edited first, light items may be approved in
/// conversation too. The line a manager reads on the review screen.
export const DECISION_1_LIMIT = 0.1;
export const DECISION_1_DAYS = 30;

export function qualityLine(
  q: { approved: number; editedBeforeApproval: number; rejected: number; firstDecidedAt: Date | null },
  now: Date
): { text: string; tone: "neutral" | "good" | "warn" } {
  if (q.approved === 0 && q.rejected === 0) return { text: `עוד לא הוחלט על הצעות ב-${DECISION_1_DAYS} הימים האחרונים.`, tone: "neutral" };
  const share = q.approved ? q.editedBeforeApproval / q.approved : 0;
  const pct = Math.round(share * 1000) / 10;
  const head = `ב-${DECISION_1_DAYS} הימים האחרונים: ${q.approved} אושרו, ${q.editedBeforeApproval} מהן אחרי עריכה (${pct}%), ${q.rejected} נדחו.`;
  const monthEnds = q.firstDecidedAt ? new Date(q.firstDecidedAt.getTime() + DECISION_1_DAYS * 86_400_000) : null;
  if (monthEnds && monthEnds.getTime() > now.getTime()) {
    const d = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" }).format(monthEnds);
    return { text: `${head} החודש הראשון נגמר ב-${d}. אז מחליטים אם אפשר לאשר פריטים קלים גם בשיחה (היעד: פחות מ-10% עם עריכה).`, tone: "neutral" };
  }
  return share < DECISION_1_LIMIT
    ? { text: `${head} פחות מ-10% תוקנו: לפי החלטה 1 אפשר לשקול לאשר פריטים קלים גם בשיחה.`, tone: "good" }
    : { text: `${head} יותר מ-10% תוקנו: ממשיכים לאשר רק כאן.`, tone: "warn" };
}

/// Every string a proposal carries, for the secret scan: a secret in a
/// context field leaks as surely as one in the body.
export function payloadText(payload: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(payload);
  return out.join("\n");
}

/// Fireflies opens a recording at a second: "08:13" -> 493.
export function secondsOf(at: string | null | undefined): number | null {
  if (!at || !/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(at)) return null;
  return at.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function firefliesLink(id: string, at?: string | null): string {
  const t = secondsOf(at);
  return `https://app.fireflies.ai/view/${encodeURIComponent(id)}${t !== null ? `?t=${t}` : ""}`;
}

/// For "already in the file": the same words, ignoring case, spacing and
/// punctuation, are the same fact.
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/// Not every extraction is knowledge: "to send Dana the contract" is
/// something to do, not something to know about the client. Such a
/// proposal becomes a task instead of being rejected or squeezed into the
/// file. A task is read by everyone on the client and by Claude, so what
/// only some may read stays a proposal.
export function taskBlocker(p: { target?: ProposalTargetLike; payload: Record<string, unknown> }): string | null {
  if (p.target === "TASK") return "ההצעה כבר משימה: אישור פותח אותה.";
  if (p.payload.sensitivity === "SENSITIVE") return "פריט רגיש לא הופך למשימה: משימה גלויה לכל מי שעובד על הלקוח.";
  if (p.payload.audience && p.payload.audience !== "ALL_STAFF") return "פריט שרק חלק מהצוות רואה לא הופך למשימה.";
  return null;
}

/// taskBlocker as a code (ADR 0006), or null.
export function taskBlockerCode(p: { target?: ProposalTargetLike; payload: Record<string, unknown> }): "alreadyTask" | "sensitive" | "partialAudience" | null {
  if (p.target === "TASK") return "alreadyTask";
  if (p.payload.sensitivity === "SENSITIVE") return "sensitive";
  if (p.payload.audience && p.payload.audience !== "ALL_STAFF") return "partialAudience";
  return null;
}

export const TASK_TITLE_MAX = 200;

// A task's title says what to do (21.10.2026). Tasks opened from proposals
// came out titled as a fact ("בנק לאומי, חשבון הבנק של החברה הישראלית:
// שכר ותשלומי ספקים...") or a question ("...בוצע?"), with no date and no
// category: nobody could tell from the list what to do, or by when.

/// "...בוצע?" is a question, not something to do.
export function isQuestionTitle(title: string): boolean {
  return /[?؟]\s*$/.test(title.trim());
}

/// The title as an action: a question becomes "לברר: ...".
export function actionTitle(title: string): string {
  const t = title.trim();
  if (!isQuestionTitle(t)) return t;
  const body = t.replace(/[?؟]+\s*$/, "").trim();
  return body.startsWith("לברר") ? body : `לברר: ${body}`;
}

/// A title that already says what to do: a Hebrew infinitive ("לשלוח",
/// "לברר") or a noun of action ("הזמנת", "תיאום"). A fact or a question is
/// not one.
const ACTION_START = /^(ל[א-ת]{2,}|הזמנת|בדיקת|שליחת|תיאום|הגשת|השלמת|מיפוי|הכנת|הפקת|תשלום|סגירת|פתיחת|עדכון|איסוף|חידוש|ביטול|העברת|קבלת|מעקב|ניהול|טיפול|הוספת|הסרת|חתימה|חתימת)(\s|:|$)/;

export function looksLikeAction(title: string): boolean {
  const t = title.trim();
  return !isQuestionTitle(t) && (ACTION_START.test(t) || /^(send|call|check|ask|book|pay|sign|update|review|prepare|schedule)\b/i.test(t));
}

/// Why a task's title will not do, or null. A proposal that was something
/// to know (a fact, a system) and turned out to be something to do needs
/// a title of its own: repeating what was said is not a task.
export function taskTitleProblem(title: string, from: { target: ProposalTargetLike; headline: string }): string | null {
  const t = title.trim();
  if (!t) return "צריך לכתוב בכותרת מה עושים.";
  if (from.target !== "TASK" && !looksLikeAction(t) && normalizeForMatch(t) === normalizeForMatch(from.headline)) {
    return 'כותרת המשימה צריכה לומר מה עושים, לא לחזור על מה שנאמר. למשל: "לברר עם דקלה מתי השכר משולם".';
  }
  return null;
}

/// taskTitleProblem as a code (ADR 0006), or null.
export function taskTitleProblemCode(title: string, from: { target: ProposalTargetLike; headline: string }): "empty" | "repeatsSaid" | null {
  const problem = taskTitleProblem(title, from);
  if (!problem) return null;
  return title.trim() ? "repeatsSaid" : "empty";
}

/// Business days a task from a proposal gets when nobody said by when.
export const TASK_DEFAULT_BUSINESS_DAYS = 3;

export function defaultTaskDue(todayKey: string): string {
  return addBusinessDays(todayKey, TASK_DEFAULT_BUSINESS_DAYS, "IL");
}

/// The task a proposal would open, before the person edits it: its line
/// as the title, and in the description why, the quote, where it is from
/// and the moment in the recording, so the task can be done without
/// going back to the meeting.
export function taskFromProposal(p: {
  target: ProposalTargetLike;
  payload: Record<string, unknown>;
  reason: string | null;
  quote: string | null;
  source: { code: string; title: string } | null;
  link: string | null;
}): { title: string; description: string; needsTitle: boolean; said: string } {
  const headline = proposalHeadline(p.target, p.payload).trim() || "משימה מהצעה";
  // Something to do keeps its line, as an action. Something that was to
  // know, and does not already read as an action, gets no title of its
  // own: the person writes what to do.
  const action = actionTitle(headline);
  const needsTitle = p.target !== "TASK" && !looksLikeAction(action);
  const title = needsTitle ? "" : action.length > TASK_TITLE_MAX ? `${action.slice(0, TASK_TITLE_MAX - 3)}...` : action;
  const s = (k: string) => (typeof p.payload[k] === "string" ? (p.payload[k] as string).trim() : "");
  const lines = [
    needsTitle ? `מה שנאמר: ${headline}` : headline.length > TASK_TITLE_MAX ? headline : null,
    p.target === "TASK" && s("description") ? s("description") : null,
    p.reason?.trim() ? `למה: ${p.reason.trim()}` : null,
    p.quote?.trim() ? `"${p.quote.trim()}"` : null,
    s("doNotDisclose") ? `לא לספר: ${s("doNotDisclose")}` : null,
    p.source ? `מקור: ${p.source.code} ${p.source.title}` : null,
    p.link ? `ברגע בשיחה: ${p.link}` : null,
    "נפתחה מהצעה של Claude בממתין לאישור.",
  ];
  return { title, description: lines.filter(Boolean).join("\n\n"), needsTitle, said: headline };
}

/// 5.11.2026: a process names its systems by name, and a name links only
/// to a system already in the file (proposal-links.ts). A process that
/// names a system the map does not have entered without the link, and the
/// card said so to a reviewer who could not fix it from there. This says
/// it to Claude instead, while it still holds the meeting: the names a
/// process in the batch uses that are neither in the client's system map
/// nor proposed as a SYSTEM in the same batch, each with the systems in
/// the map whose name looks like it ("Claude" and "Claude, חשבון התפעול"),
/// so it uses that name rather than opening a second system.
export type MissingSystem = { index: number; name: string; similar: { id: string; name: string }[] };

export function missingSystems(
  items: { index: number; target: string; action?: string | null; payload: Record<string, unknown> }[],
  existing: { id: string; name: string }[]
): MissingSystem[] {
  // The same match the link makes on approval (systemByName): case and
  // spaces aside, the name exactly. Looser only for the suggestions.
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
  const inMap = new Set(existing.map((s) => key(s.name)));
  const inBatch = new Set(
    items.filter((i) => i.target === "SYSTEM" && (i.action ?? "CREATE") === "CREATE" && typeof i.payload.systemName === "string").map((i) => key(i.payload.systemName as string))
  );
  const out: MissingSystem[] = [];
  for (const item of items) {
    if (item.target !== "PROCESS") continue;
    const steps = Array.isArray(item.payload.steps) ? (item.payload.steps as { systemNames?: unknown }[]) : [];
    const named = [...strings(item.payload.systemNames), ...steps.flatMap((st) => strings(st?.systemNames))];
    const seen = new Set<string>();
    for (const raw of named) {
      const k = key(raw);
      if (!k || seen.has(k) || inMap.has(k) || inBatch.has(k)) continue;
      seen.add(k);
      const loose = normalizeForMatch(raw);
      const similar = existing.filter((s) => {
        const e = normalizeForMatch(s.name);
        return e.length >= 3 && loose.length >= 3 && (e.includes(loose) || loose.includes(e));
      });
      out.push({ index: item.index, name: raw.trim().replace(/\s+/g, " "), similar });
    }
  }
  return out;
}
