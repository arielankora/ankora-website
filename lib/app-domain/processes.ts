import "server-only";
import { Prisma } from "@prisma/client";
import type { KnowledgeAudience, LeadUnit, ProcedureClassification, ProcessStatus, ProcessTransition, ProcessTrigger, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DomainError } from "@/lib/domain-error";
import { approvesProceduresOf, NOT_APPROVER, procedureApprovalBlocker, SEPARATION_REQUIRED } from "@/lib/procedure-approval";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSeeKnowledgeItem } from "@/lib/knowledge";
import { findSecrets } from "@/lib/secret-scan";
import { isExceptionInForce, ruleBindsNow, type PolicyKindLike } from "@/lib/client-policies";
import { hasParams, invoiceGaps, paramsInForce, requestTypeConflicts, ruleChecks, type RuleForCheck, type RuleSeverity } from "@/lib/policy-params";
import { CHECK_MAX_DAYS, checkEveryError } from "@/lib/process-checks";
import { MAX_REVIEW_EVERY_DAYS, reviewEveryError } from "@/lib/process-review";
import {
  MAX_PROCESS_STEPS,
  blockingChecks,
  completeness,
  documentation,
  processGaps,
  readNotApplicable,
  readSteps,
  FIELD_LABELS,
  NOT_APPLICABLE_FIELDS,
  type NotApplicableField,
  type CheckResult,
  type ProcessStep,
} from "@/lib/process-rules";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { assertEntityBelongs } from "@/lib/app-domain/client-entities";
import { assertResolvable, knowledgeData, sourcedFields, type KnowledgeInput } from "@/lib/app-domain/knowledge-items";
import { syncDateCalendars } from "@/lib/app-domain/date-calendars";
import { isBusinessCalendarKey } from "@/lib/business-calendar";
import { readControlRefs } from "@/lib/procedure-document";
import { buildSnapshot } from "@/lib/app-domain/procedure-documents";
import { runReadiness } from "@/lib/process-readiness";
import { stepsDraftPrompt } from "@/lib/stranger-test";
import { runLeadBusinessDays } from "@/lib/process-runs";
import { attachLinkedDates, syncStartsFromKinds } from "@/lib/app-domain/process-rhythm";
import { describeRhythm } from "@/lib/process-rhythm";
import { computeLeadDate } from "@/lib/app-domain/important-dates-recurrence";
import { mentionedIn, processTexts, type Named } from "@/lib/process-mentions";
import { flowFromSteps, flowIssues, flowSteps, readFlow, secondEyeNodes, type ProcessFlow } from "@/lib/process-flow";

// Org brain, phase 1: processes and their procedures
// (claude/org-brain-spec-2026-10-12.md, 3.8, 3.9; Hadas's review approved
// 15.10.2026).
//
// A process is knowledge like any other item in the file: anyone on the
// client writes it down, with a source. Its procedure is versioned like a
// task plan: a change is a new version saved against the one it started
// from, so two people editing at once cannot overwrite each other. A
// manager approves a version, and that is when the checks that block are
// run (R1 to R4): a procedure that would automate a payment, or skip the
// approval the client's rules require, never becomes the one that runs.
//
// Runs (a date opening a task with the steps) come next, from the
// approved version only.

export interface ProcessInput extends KnowledgeInput {
  clientId: string;
  title: string;
  purpose?: string | null;
  triggerKinds?: ProcessTrigger[];
  triggerText?: string | null;
  /// 13.11.2026 (stage 1): notes on the rhythm that schedule nothing.
  triggerNotes?: string | null;
  ownerId?: string | null;
  backupOwnerId?: string | null;
  slaText?: string | null;
  slaBusinessDays?: number | null;
  externalPartyContactIds?: string[];
  externalPartyText?: string | null;
  requiredSystemIds?: string[];
  /// Spec 3.9: the permission each required system needs, by its id.
  requiredSystemPermissions?: Record<string, string>;
  approverText?: string | null;
  approverContactId?: string | null;
  /// Spec 5.3: who at Ankora signs an approval step, in the product.
  approverUserId?: string | null;
  approvalPolicyIds?: string[];
  approvalText?: string | null;
  exceptionPlaybook?: string | null;
  entityId?: string | null;
  /// "IL", "US", or null for the entity's country (decision 6).
  businessCalendar?: string | null;
  executorText?: string | null;
  /// Spec 3.9: who does it today, linked: a person at Ankora or a contact.
  executorUserId?: string | null;
  executorContactId?: string | null;
  transitionStatus?: ProcessTransition;
  /// An ongoing process only: a check every N days, and what is checked.
  checkEveryDays?: number | null;
  checkText?: string | null;
  /// Review the procedure every N days (spec 5.4).
  reviewEveryDays?: number | null;
  // The procedure as a document (23.10.2026).
  scope?: string | null;
  definitions?: string | null;
  controlRefs?: string[];
  classification?: ProcedureClassification;
  relatedDocs?: string | null;
  /// 25.10.2026: documentation fields not relevant to this process.
  notApplicableFields?: string[];
}

export class ProcessVersionConflictError extends DomainError {
  constructor(public latest: number) {
    super("processes.versionConflict", `מישהו שמר גרסה חדשה של הנוהל (גרסה ${latest}) בזמן שערכת. רעננו, ובדקו מה השתנה לפני ששומרים.`, { latest: String(latest) });
  }
}

/// The refusal assertIdsBelong gives when a chosen id is not the client's.
/// Each Hebrew message is the one it has always given.
const NOT_IN_FILE = {
  contact: () => new DomainError("processes.contactNotInFile", "איש קשר שנבחר לא נמצא בתיק של הלקוח."),
  system: () => new DomainError("processes.systemNotInFile", "המערכת שנבחרה לא נמצאה בתיק של הלקוח."),
  rule: () => new DomainError("processes.ruleNotInFile", "כלל שנבחר לא נמצא בתיק של הלקוח."),
  approver: () => new DomainError("processes.approverNotInFile", "המאשר שנבחר לא נמצא בתיק של הלקוח."),
  executor: () => new DomainError("processes.executorNotInFile", "המבצע שנבחר לא נמצא בתיק של הלקוח."),
} as const;

const clean = (v: string | null | undefined) => v?.trim() || null;

async function assertIdsBelong(clientId: string, input: Partial<ProcessInput>) {
  const check = async (ids: string[] | undefined, count: (ids: string[]) => Promise<number>, kind: keyof typeof NOT_IN_FILE) => {
    const unique = [...new Set((ids ?? []).filter(Boolean))];
    if (unique.length && (await count(unique)) !== unique.length) throw NOT_IN_FILE[kind]();
    return ids === undefined ? undefined : unique;
  };
  const contacts = await check(input.externalPartyContactIds, (ids) => prisma.clientContact.count({ where: { id: { in: ids }, clientId, deletedAt: null } }), "contact");
  const systems = await check(input.requiredSystemIds, (ids) => prisma.systemAccess.count({ where: { id: { in: ids }, clientId, deletedAt: null } }), "system");
  const policies = await check(input.approvalPolicyIds, (ids) => prisma.clientPolicy.count({ where: { id: { in: ids }, clientId, deletedAt: null } }), "rule");
  if (input.approverContactId) await check([input.approverContactId], (ids) => prisma.clientContact.count({ where: { id: { in: ids }, clientId, deletedAt: null } }), "approver");
  if (input.executorContactId) await check([input.executorContactId], (ids) => prisma.clientContact.count({ where: { id: { in: ids }, clientId, deletedAt: null } }), "executor");
  if (input.executorUserId) {
    const ok = await prisma.user.count({ where: { id: input.executorUserId, deletedAt: null, role: { not: "CLIENT_USER" } } });
    if (!ok) throw new DomainError("processes.executorNotStaff", "המבצע באנקורה צריך להיות איש צוות.");
  }
  for (const id of [input.ownerId, input.backupOwnerId].filter((x): x is string => !!x)) {
    const ok = await prisma.user.count({ where: { id, deletedAt: null, role: { not: "CLIENT_USER" } } });
    if (!ok) throw new DomainError("processes.ownerNotStaff", "אחראי או מחליף צריכים להיות אנשי צוות של אנקורה.");
  }
  // The approver signs a step on this client's task: someone on the
  // client, or a manager, who reaches every client.
  if (input.approverUserId) {
    const ok = await prisma.user.count({
      where: { id: input.approverUserId, deletedAt: null, status: "ACTIVE", role: { not: "CLIENT_USER" }, OR: [{ role: { in: (["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE"] as const).filter((r) => canManageClients(r)) } }, { clientAccess: { some: { clientId } } }] },
    });
    if (!ok) throw new DomainError("processes.approverNotAllowed", "המאשר באנקורה צריך להיות איש צוות פעיל שמשויך ללקוח, או מנהל.");
  }
  if (input.entityId !== undefined) await assertEntityBelongs(clientId, input.entityId);
  return { contacts, systems, policies };
}

/// Only for systems the process needs; a permission of a system taken off
/// the list goes with it. Untouched when neither is given.
function permissionsFor(input: Partial<ProcessInput>, systems: string[] | undefined): Prisma.InputJsonValue | undefined {
  if (input.requiredSystemPermissions === undefined) return undefined;
  const keep = systems ?? Object.keys(input.requiredSystemPermissions);
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(input.requiredSystemPermissions)) {
    const t = text?.trim().slice(0, 200);
    if (t && keep.includes(id)) out[id] = t;
  }
  return out;
}

function fields(input: Partial<ProcessInput>, ids: { contacts?: string[]; systems?: string[]; policies?: string[] }) {
  const reviewError = reviewEveryError(input.reviewEveryDays);
  if (reviewError) throw new DomainError("processes.reviewRange", reviewError, { max: MAX_REVIEW_EVERY_DAYS });
  if (input.businessCalendar && !isBusinessCalendarKey(input.businessCalendar)) throw new DomainError("processes.calendarUnknown", "לוח ימי העבודה לא מוכר.");
  if (input.slaBusinessDays !== undefined && input.slaBusinessDays !== null && (!Number.isInteger(input.slaBusinessDays) || input.slaBusinessDays < 0 || input.slaBusinessDays > 60)) {
    throw new DomainError("processes.slaRange", "ה-SLA בימי עסקים הוא מספר שלם בין 0 ל-60.");
  }
  return {
    title: input.title !== undefined ? input.title.trim() : undefined,
    purpose: input.purpose !== undefined ? clean(input.purpose) : undefined,
    triggerKinds: input.triggerKinds !== undefined ? [...new Set(input.triggerKinds)] : undefined,
    triggerText: input.triggerText !== undefined ? clean(input.triggerText) : undefined,
    triggerNotes: input.triggerNotes !== undefined ? clean(input.triggerNotes) : undefined,
    ownerId: input.ownerId !== undefined ? input.ownerId || null : undefined,
    backupOwnerId: input.backupOwnerId !== undefined ? input.backupOwnerId || null : undefined,
    slaText: input.slaText !== undefined ? clean(input.slaText) : undefined,
    slaBusinessDays: input.slaBusinessDays !== undefined ? input.slaBusinessDays : undefined,
    externalPartyContactIds: ids.contacts,
    externalPartyText: input.externalPartyText !== undefined ? clean(input.externalPartyText) : undefined,
    requiredSystemIds: ids.systems,
    requiredSystemPermissions: permissionsFor(input, ids.systems),
    approverText: input.approverText !== undefined ? clean(input.approverText) : undefined,
    approverContactId: input.approverContactId !== undefined ? input.approverContactId || null : undefined,
    approverUserId: input.approverUserId !== undefined ? input.approverUserId || null : undefined,
    approvalPolicyIds: ids.policies,
    approvalText: input.approvalText !== undefined ? clean(input.approvalText) : undefined,
    exceptionPlaybook: input.exceptionPlaybook !== undefined ? clean(input.exceptionPlaybook) : undefined,
    entityId: input.entityId !== undefined ? input.entityId || null : undefined,
    businessCalendar: input.businessCalendar !== undefined ? input.businessCalendar || null : undefined,
    executorText: input.executorText !== undefined ? clean(input.executorText) : undefined,
    executorUserId: input.executorUserId !== undefined ? input.executorUserId || null : undefined,
    executorContactId: input.executorContactId !== undefined ? input.executorContactId || null : undefined,
    transitionStatus: input.transitionStatus ?? undefined,
    checkEveryDays: input.checkEveryDays !== undefined ? input.checkEveryDays : undefined,
    checkText: input.checkText !== undefined ? clean(input.checkText) : undefined,
    reviewEveryDays: input.reviewEveryDays !== undefined ? input.reviewEveryDays : undefined,
    scope: input.scope !== undefined ? clean(input.scope) : undefined,
    definitions: input.definitions !== undefined ? clean(input.definitions) : undefined,
    controlRefs: input.controlRefs !== undefined ? readControlRefs(input.controlRefs) : undefined,
    classification: input.classification ?? undefined,
    relatedDocs: input.relatedDocs !== undefined ? clean(input.relatedDocs) : undefined,
    notApplicableFields: input.notApplicableFields !== undefined ? readNotApplicable(input.notApplicableFields) : undefined,
  };
}

/// A check belongs to an ongoing process: a scheduled one has its dates,
/// and a check on top of them would be a second clock nobody reads.
function assertCheck(triggerKinds: ProcessTrigger[], checkEveryDays: number | null | undefined) {
  const error = checkEveryError(checkEveryDays);
  if (error) throw new DomainError("processes.checkRange", error, { max: CHECK_MAX_DAYS });
  if (checkEveryDays && !triggerKinds.includes("CONTINUOUS")) throw new DomainError("processes.checkNotContinuous", "בדיקה תקופתית היא לתהליך שוטף.");
}

function assertNoSecrets(input: Partial<ProcessInput>) {
  const text = [input.title, input.purpose, input.triggerText, input.triggerNotes, input.slaText, input.externalPartyText, input.approverText, input.approvalText, input.exceptionPlaybook, input.executorText, input.checkText, input.scope, input.definitions, input.relatedDocs]
    .filter(Boolean)
    .join("\n");
  if (findSecrets(text).length) throw new DomainError("processes.secrets", "יש כאן סיסמה, מפתח או מספר כרטיס. סודות נשמרים בכספת, לא בתיק.");
}

async function findProcess(actor: User, id: string) {
  const row = await prisma.process.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw new DomainError("processes.notFound", "התהליך לא נמצא.");
  await assertClientAccess(actor, row.clientId);
  return row;
}

export async function addProcess(actor: User, input: ProcessInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  if (!input.title?.trim()) throw new DomainError("processes.titleRequired", "צריך שם לתהליך.");
  assertNoSecrets(input);
  assertCheck(input.triggerKinds ?? [], input.checkEveryDays);
  assertResolvable(input.knowledgeStatus, input.toResolve);
  const ids = await assertIdsBelong(input.clientId, input);
  const sourced = await sourcedFields(input.clientId, input, [input.purpose, input.triggerText, input.exceptionPlaybook]);
  // The next number, never reused, as in the source register.
  for (let attempt = 0; ; attempt++) {
    const last = await prisma.process.findFirst({ where: { clientId: input.clientId }, orderBy: { seq: "desc" }, select: { seq: true } });
    const seq = (last?.seq ?? 0) + 1;
    try {
      const row = await prisma.process.create({
        data: {
          ...fields(input, ids),
          title: input.title.trim(),
          clientId: input.clientId,
          seq,
          code: `P${seq}`,
          createdById: actor.id,
          ...knowledgeData(input),
          ...sourced,
        },
      });
      await recordAudit({ actorId: actor.id, action: "process.add", entityType: "Process", entityId: row.id, clientId: input.clientId, after: row });
      // 13.11.2026 (stage 1): a process written with trigger kinds (Claude's
      // proposal) gets the starts they say.
      if (input.triggerKinds?.length) await syncStartsFromKinds(row.id);
      return row;
    } catch (err) {
      if (attempt < 3 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
}

export async function updateProcess(actor: User, id: string, input: Partial<Omit<ProcessInput, "clientId">>) {
  assertCan(actor.role, "time_entry.create_self");
  const before = await findProcess(actor, id);
  if (input.title !== undefined && !input.title.trim()) throw new DomainError("processes.titleRequired", "צריך שם לתהליך.");
  assertNoSecrets(input);
  assertCheck(input.triggerKinds ?? before.triggerKinds, input.checkEveryDays !== undefined ? input.checkEveryDays : before.checkEveryDays);
  assertResolvable(input.knowledgeStatus ?? before.knowledgeStatus, input.toResolve !== undefined ? input.toResolve : before.toResolve);
  const ids = await assertIdsBelong(before.clientId, input);
  const sourced = await sourcedFields(before.clientId, input, [input.purpose ?? before.purpose, input.triggerText ?? before.triggerText], before);
  const updated = await prisma.process.update({ where: { id }, data: { ...fields(input, ids), ...knowledgeData(input), ...sourced } });
  await recordAudit({ actorId: actor.id, action: "process.update", entityType: "Process", entityId: id, clientId: before.clientId, before, after: updated });
  if (input.triggerKinds !== undefined || input.checkEveryDays !== undefined) await syncStartsFromKinds(id);
  // Decision 6: its dates follow its calendar.
  if (updated.businessCalendar !== before.businessCalendar || updated.entityId !== before.entityId) await syncDateCalendars({ processId: id });
  return updated;
}

/// Pause, resume or retire. A manager's call: a paused process opens no
/// runs.
export async function setProcessStatus(actor: User, id: string, status: Exclude<ProcessStatus, "DRAFT">) {
  if (!canManageClients(actor.role)) throw new DomainError("processes.statusManagerOnly", "רק מנהל משהה, מחדש או מבטל תהליך.");
  const before = await findProcess(actor, id);
  if (status === "ACTIVE") {
    const approved = await prisma.processVersion.count({ where: { processId: id, status: "APPROVED" } });
    if (!approved) throw new DomainError("processes.noApprovedProcedure", "לתהליך עוד אין נוהל מאושר.");
  }
  const updated = await prisma.process.update({ where: { id }, data: { status } });
  await recordAudit({ actorId: actor.id, action: "process.status", entityType: "Process", entityId: id, clientId: before.clientId, before: { status: before.status }, after: { status } });
  return updated;
}

/// 13.11.2026 (processes redesign, stage 2): a process that runs, or a work
/// instruction. A work instruction keeps its rhythm stored but opens no
/// runs (the daily job skips it) and is never "will not run".
export async function setProcessKind(actor: User, id: string, kind: "PROCESS" | "GUIDE") {
  assertCan(actor.role, "time_entry.create_self");
  const before = await findProcess(actor, id);
  if (before.kind === kind) return before;
  const updated = await prisma.process.update({ where: { id }, data: { kind } });
  await recordAudit({ actorId: actor.id, action: "process.kind", entityType: "Process", entityId: id, clientId: before.clientId, before: { kind: before.kind }, after: { kind } });
  return updated;
}

/// A process written by mistake, before any procedure was approved. One
/// that ran is retired instead, so its history stays.
export async function removeProcess(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const row = await findProcess(actor, id);
  if (row.status !== "DRAFT") throw new DomainError("processes.removeApproved", "תהליך שהיה לו נוהל מאושר לא נמחק. מבטלים אותו, והוא נשאר בהיסטוריה.");
  await prisma.importantDate.updateMany({ where: { processId: id }, data: { processId: null } });
  const removed = await prisma.process.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "process.remove", entityType: "Process", entityId: id, clientId: row.clientId, before: row });
  return removed;
}

/// 13.11.2026 (processes redesign, stage 0): a draft of the procedure
/// nobody will approve is given up. Only the newest version, only while it
/// is a draft, and only by whoever wrote it or a manager (Ariel). The
/// approved procedure, when there is one, keeps running as before.
export async function discardProcessVersion(actor: User, processId: string, version: number) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await findProcess(actor, processId);
  const latest = await prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" } });
  if (!latest || latest.version !== version || latest.status !== "DRAFT") {
    throw new DomainError("processes.discardNotDraft", "אפשר לוותר רק על הטיוטה האחרונה, לפני שאושרה.");
  }
  if (latest.createdById !== actor.id && !canManageClients(actor.role)) {
    throw new DomainError("processes.discardNotAuthor", "רק מי שכתב את הטיוטה, או מנהל, מוותר עליה.");
  }
  await prisma.processVersion.delete({ where: { id: latest.id } });
  await recordAudit({
    actorId: actor.id,
    action: "process.version_discard",
    entityType: "Process",
    entityId: processId,
    clientId: process.clientId,
    before: { version: latest.version, steps: latest.steps, highlights: latest.highlights, outputs: latest.outputs, changeNote: latest.changeNote },
  });
  return { version: latest.version };
}

/// The dates that start this process (spec 3.10): this client's dates
/// only. Replaces the set.
export async function linkProcessDates(actor: User, processId: string, dateIds: string[]) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await findProcess(actor, processId);
  const unique = [...new Set(dateIds.filter(Boolean))];
  const found = await prisma.importantDate.count({ where: { id: { in: unique }, clientId: process.clientId, deletedAt: null } });
  if (found !== unique.length) throw new DomainError("processes.dateNotFound", "מועד שנבחר לא נמצא אצל הלקוח.");
  await prisma.$transaction([
    prisma.importantDate.updateMany({ where: { processId, id: { notIn: unique } }, data: { processId: null } }),
    prisma.importantDate.updateMany({ where: { id: { in: unique } }, data: { processId } }),
  ]);
  await recordAudit({ actorId: actor.id, action: "process.dates", entityType: "Process", entityId: processId, clientId: process.clientId, after: { dateIds: unique } });
  await syncDateCalendars({ processId });
  await attachLinkedDates(processId);
}

// ---------------------------------------------------------------------------
// The procedure, in versions
// ---------------------------------------------------------------------------

export type VersionInput = {
  steps: unknown;
  /// A procedure built as a flow (lib/process-flow.ts). When given, the
  /// steps are derived from it and `steps` is ignored.
  flow?: unknown;
  highlights?: string | null;
  outputs?: string | null;
  changeNote?: string | null;
  /// The version this edit started from; 0 for the first.
  baseVersion: number;
};

/// One check a procedure faces, with how much it weighs. `excepted`: the
/// rule it is about has an approved exception in force, so it does not
/// hold the approval back (spec 7.2, "דורש חריגה").
export type ProcessCheckResult = CheckResult & { severity: RuleSeverity; policyId?: string; excepted?: boolean };

/// Everything the checks need about the client's rules, read once.
export type RuleContext = {
  /// Approval rules in force with nothing for the server to compare, by
  /// title: R2 then holds any money step to "some step is approved".
  textOnlyApprovals: string[];
  rules: RuleForCheck[];
  exceptedPolicyIds: Set<string>;
  contacts: Map<string, { name: string; entityId: string | null }>;
};

/// A rule binds whoever reads it or not; its title is shown only to who
/// may see it.
const HIDDEN_RULE_TITLE = "כלל של הלקוח שמוגבל לצפייה";

export async function ruleContext(
  clientId: string,
  options: { now?: Date; canSee?: (r: { audience: KnowledgeAudience; audienceUserIds: string[] }) => boolean } = {}
): Promise<RuleContext> {
  const now = options.now ?? new Date();
  const [policies, exceptions, contacts] = await Promise.all([
    prisma.clientPolicy.findMany({
      where: { clientId, deletedAt: null, status: { not: "RETIRED" } },
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        statement: true,
        interimStatement: true,
        params: true,
        interimParams: true,
        audience: true,
        audienceUserIds: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.policyException.findMany({ where: { clientId, status: "APPROVED" }, select: { policyId: true, status: true, validUntil: true } }),
    prisma.clientContact.findMany({
      where: { clientId, deletedAt: null },
      select: { id: true, role: true, entityId: true, audience: true, audienceUserIds: true, person: { select: { name: true } } },
    }),
  ]);
  const rules: RuleForCheck[] = [];
  const textOnlyApprovals: string[] = [];
  for (const r of policies) {
    // A rule that starts later is not checked yet (spec 3.11).
    if (!ruleBindsNow(r)) continue;
    const title = !options.canSee || options.canSee(r) ? r.title : HIDDEN_RULE_TITLE;
    const params = paramsInForce({ ...r, kind: r.kind as PolicyKindLike });
    if (hasParams(params)) rules.push({ id: r.id, title, kind: r.kind as PolicyKindLike, params });
    else if (r.kind === "THRESHOLD" || r.kind === "APPROVAL_REQUIRED") textOnlyApprovals.push(title);
  }
  return {
    textOnlyApprovals,
    rules,
    exceptedPolicyIds: new Set(exceptions.filter((e) => isExceptionInForce(e, now)).map((e) => e.policyId)),
    contacts: new Map(
      contacts.map((c) => [c.id, { name: !options.canSee || options.canSee(c) ? c.person.name ?? c.role ?? "איש קשר" : "איש קשר מוגבל לצפייה", entityId: c.entityId }])
    ),
  };
}

/// R1 to R4 (always block), and the client's rules (R2 blocks; R7 to R10
/// and R15 need an exception).
export function processChecks(
  version: { steps: ProcessStep[]; highlights?: string | null; outputs?: string | null },
  process: { entityId: string | null; externalPartyContactIds: string[] },
  ctx: RuleContext
): ProcessCheckResult[] {
  const base: ProcessCheckResult[] = blockingChecks(version, ctx.textOnlyApprovals).map((c) => ({ ...c, severity: "BLOCK" as const }));
  const rules: ProcessCheckResult[] = ruleChecks(
    {
      steps: version.steps,
      entityId: process.entityId,
      externalParties: process.externalPartyContactIds.map((id) => ctx.contacts.get(id)).filter((c): c is { name: string; entityId: string | null } => !!c),
    },
    ctx.rules
  ).map((c) => ({ ...c, excepted: c.severity === "EXCEPTION" && ctx.exceptedPolicyIds.has(c.policyId) }));
  return [...base, ...rules];
}

/// What holds an approval back: anything blocking, and anything needing an
/// exception that has none.
export function holdsApproval(checks: ProcessCheckResult[]): ProcessCheckResult[] {
  return checks.filter((c) => c.severity === "BLOCK" || !c.excepted);
}

/// Why a procedure built as a flow is not saved as a list.
export const FLOW_ONLY_MESSAGE = "הנוהל הזה נבנה כזרימה עם תנאים. עורכים אותו ב\"עורך זרימה\", כדי שהענפים לא ילכו לאיבוד.";

export async function saveProcessVersion(actor: User, processId: string, input: VersionInput) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await findProcess(actor, processId);
  let flow: ProcessFlow | null = null;
  if (input.flow !== undefined && input.flow !== null) {
    flow = readFlow(input.flow);
    if (!flow) throw new DomainError("processes.flowUnread", "הזרימה לא נקראה. רעננו ונסו שוב.");
    const issues = flowIssues(flow);
    if (issues.length) throw new Error(issues.map((i) => i.message).join(" "));
  }
  const steps = flow ? flowSteps(flow) : readSteps(input.steps);
  if (steps.length === 0) throw new DomainError("processes.noSteps", "נוהל צריך לפחות שלב אחד.");
  if (steps.length > MAX_PROCESS_STEPS) throw new DomainError("processes.tooManySteps", `עד ${MAX_PROCESS_STEPS} שלבים. נוהל ארוך מזה הוא כמה תהליכים.`, { max: MAX_PROCESS_STEPS });
  const systemIds = [...new Set(steps.flatMap((s) => s.systemIds))];
  if (systemIds.length) {
    const found = await prisma.systemAccess.count({ where: { id: { in: systemIds }, clientId: process.clientId, deletedAt: null } });
    if (found !== systemIds.length) throw new DomainError("processes.stepSystemNotFound", "מערכת שנבחרה בשלב לא נמצאת במפת המערכות של הלקוח.");
  }
  const version = { steps, highlights: clean(input.highlights), outputs: clean(input.outputs) };
  // A secret blocks the save itself, not only the approval (R4): a draft
  // is stored, and stored is enough to leak.
  const secret = blockingChecks(version, []).find((c) => c.code === "R4");
  if (secret) throw new Error(secret.message);

  const latest = await prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" }, select: { version: true, flow: true } });
  const latestVersion = latest?.version ?? 0;
  if (latestVersion !== input.baseVersion) throw new ProcessVersionConflictError(latestVersion);
  // 5.11.2026: a procedure built as a flow is edited as a flow. Saving it
  // as a list (the list editor, a proposal from Claude) would drop its
  // conditions and branches without a word, so it is refused instead.
  if (!flow && latest && readFlow(latest.flow)) throw new DomainError("processes.flowOnly", FLOW_ONLY_MESSAGE);
  try {
    const row = await prisma.processVersion.create({
      data: {
        processId,
        version: latestVersion + 1,
        steps: steps as unknown as Prisma.InputJsonValue,
        flow: flow ? (flow as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        highlights: version.highlights,
        outputs: version.outputs,
        changeNote: clean(input.changeNote),
        createdById: actor.id,
      },
    });
    await recordAudit({ actorId: actor.id, action: "process.version_save", entityType: "Process", entityId: processId, clientId: process.clientId, after: { version: row.version, steps: steps.length } });
    return row;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ProcessVersionConflictError(latestVersion + 1);
    throw err;
  }
}

/// What the flow editor opens with (task cmvtivumj000pjs08q9qj4t67): the
/// newest version as a flow, a list turned into one when it was saved as a
/// list, and what the editor shows around it.
export type FlowEditorData = {
  processId: string;
  clientId: string;
  code: string;
  title: string;
  triggerText: string | null;
  latestVersion: number;
  latestStatus: "DRAFT" | "APPROVED" | "SUPERSEDED" | null;
  flow: ProcessFlow;
  /// The flow was built from a list just now, not saved as a flow.
  fromList: boolean;
  highlights: string | null;
  outputs: string | null;
  contacts: { id: string; name: string }[];
  /// The client's live connections a branch can check through.
  connections: { id: string; kind: "GOOGLE_OAUTH" | "MAIL_APP_PASSWORD" | "MANAGER_SEND"; account: string }[];
};

export async function flowForEditor(actor: User, processId: string): Promise<FlowEditorData> {
  const process = await findProcess(actor, processId);
  const latest = await prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" } });
  const saved = latest ? readFlow(latest.flow) : null;
  const rows = await prisma.clientContact.findMany({ where: { clientId: process.clientId, deletedAt: null }, select: { id: true, role: true, person: { select: { name: true } } }, take: 200 });
  const contacts = rows
    .map((r) => ({ id: r.id, name: [r.person.name, r.role].filter(Boolean).join(", ") || "איש קשר בלי שם" }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
  return {
    processId,
    clientId: process.clientId,
    code: process.code,
    title: process.title,
    triggerText: process.triggerText,
    latestVersion: latest?.version ?? 0,
    latestStatus: latest?.status ?? null,
    flow: saved ?? (latest ? flowFromSteps(readSteps(latest.steps)) : { v: 1, start: null, nodes: [] }),
    fromList: !saved,
    highlights: latest?.highlights ?? null,
    outputs: latest?.outputs ?? null,
    contacts,
    connections: await prisma.clientConnection.findMany({ where: { clientId: process.clientId, revokedAt: null }, select: { id: true, kind: true, account: true }, orderBy: { connectedAt: "asc" } }),
  };
}

/// "קלוד מנסח שלבים" (14.11.2026, stage 3): Claude's draft of the steps of
/// a process that has none, saved as a draft version. Refused once the
/// process has steps, so it never writes over a person's procedure.
export async function saveProcedureDraft(actor: User, processId: string, steps: unknown[]) {
  const process = await findProcess(actor, processId);
  const latest = await prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" } });
  if (latest && readSteps(latest.steps).length > 0) throw new DomainError("processes.draftHasSteps", "לתהליך כבר יש שלבים. עורכים אותם בעורך השלבים.");
  const clean = readSteps(steps);
  if (!clean.length) throw new DomainError("processes.draftEmpty", "הטיוטה ריקה.");
  const row = await saveProcessVersion(actor, processId, { steps: clean, baseVersion: latest?.version ?? 0, changeNote: "טיוטה שקלוד ניסח" });
  return { version: row.version, steps: clean.length };
}

/// "להכין לביקורת" (14.11.2026, processes redesign, stage 4): what Claude
/// drafted for an audited client's procedure. "איך יודעים שבוצע" for the
/// steps named goes into a new draft version of the latest steps, a person
/// approves it; the steps themselves are not changed. Scope and controls
/// are filled only where the process has none, and reach the document with
/// that approval.
export async function saveAuditDraft(
  actor: User,
  processId: string,
  input: { scope?: string | null; controlRefs?: string[] | null; evidence?: { step: number; text: string }[] }
) {
  const process = await findProcess(actor, processId);
  const client = await prisma.client.findUnique({ where: { id: process.clientId }, select: { auditRequirements: true } });
  if (!client?.auditRequirements) throw new DomainError("processes.notAudited", "ללקוח הזה אין דרישות ביקורת.");
  const latest = await prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" } });
  const flow = latest ? readFlow(latest.flow) : null;
  if (flow) throw new DomainError("processes.auditDraftFlow", "הנוהל בנוי כתרשים. משלימים בו \"איך יודעים שבוצע\" בעורך השלבים.");
  const steps = latest ? readSteps(latest.steps) : [];
  let version: number | null = null;
  const filled: number[] = [];
  if (input.evidence?.length && steps.length) {
    const next = steps.map((st, i) => {
      const e = input.evidence!.find((x) => x.step === i + 1)?.text?.trim().slice(0, 500);
      if (!e || st.evidence?.trim()) return st;
      filled.push(i + 1);
      return { ...st, evidence: e, ...(st.mode === "AUTOMATED" && !st.verification ? { verification: e } : {}) };
    });
    if (filled.length) {
      const row = await saveProcessVersion(actor, processId, { steps: next, highlights: latest?.highlights ?? null, outputs: latest?.outputs ?? null, baseVersion: latest?.version ?? 0, changeNote: "הכנה לביקורת: איך יודעים שבוצע" });
      version = row.version;
    }
  }
  const data: Prisma.ProcessUpdateInput = {};
  if (input.scope?.trim() && !process.scope?.trim()) data.scope = input.scope.trim().slice(0, 2000);
  const refs = (input.controlRefs ?? []).map((r) => r.trim()).filter(Boolean).slice(0, 30);
  if (refs.length && !process.controlRefs.length) data.controlRefs = refs;
  if (Object.keys(data).length) {
    await prisma.process.update({ where: { id: processId }, data });
    await recordAudit({ actorId: actor.id, action: "process.audit_prep", entityType: "Process", entityId: processId, clientId: process.clientId, after: { ...data, version } });
  }
  return { version, evidenceSteps: filled, scope: !!data.scope, controls: !!data.controlRefs };
}

/// 14.11.2026 (processes redesign, stage 3, "Steps.dc.html"): what the one
/// steps editor needs. The procedure as a list, or as a flow when it has a
/// condition; the people a step may name (who does it, who approves it);
/// the client's systems; and whether this person may save and approve at
/// once ("שמירה ואישור", Ariel 14.11.2026).
export type StepsEditorData = FlowEditorData & {
  clientName: string;
  /// "קלוד מנסח שלבים": the prompt to copy, or null for a client marked
  /// "בלי AI" (lib/ai-exclusion.ts).
  draftPrompt: string | null;
  purpose: string | null;
  /// The version being edited: the draft when there is one, else the
  /// approved one; and the approved one that keeps running meanwhile.
  editing: { version: number; status: "DRAFT" | "APPROVED" | "SUPERSEDED" } | null;
  runningVersion: number | null;
  steps: ProcessStep[];
  /// The saved version is a flow that a list cannot hold.
  isFlow: boolean;
  executor: string | null;
  staff: { id: string; name: string }[];
  /// The client's contacts, with whether they left (spec 4.6).
  people: { id: string; name: string; ended: boolean }[];
  systems: { id: string; name: string }[];
  mayApprove: boolean;
  /// The client's rules' checks on the saved version, as the server read
  /// them (the steps' own checks run in the editor as you type).
  ruled: { code: string; message: string; step?: number }[];
};

export async function stepsForEditor(actor: User, processId: string): Promise<StepsEditorData> {
  const base = await flowForEditor(actor, processId);
  const process = await findProcess(actor, processId);
  const [latest, running, staff, contacts, systems, client] = await Promise.all([
    prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" } }),
    prisma.processVersion.findFirst({ where: { processId, status: "APPROVED" }, select: { version: true } }),
    prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE", role: { not: "CLIENT_USER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.clientContact.findMany({ where: { clientId: process.clientId, deletedAt: null }, select: { id: true, role: true, endedAt: true, person: { select: { name: true } } }, take: 200 }),
    prisma.systemAccess.findMany({ where: { clientId: process.clientId, deletedAt: null }, select: { id: true, systemName: true }, orderBy: { systemName: "asc" } }),
    prisma.client.findUnique({ where: { id: process.clientId }, select: { accountManagerId: true, name: true, aiExcluded: true } }),
  ]);
  const saved = latest ? readFlow(latest.flow) : null;
  const executorUser = process.executorUserId ? staff.find((u) => u.id === process.executorUserId)?.name : null;
  const executorContact = process.executorContactId ? contacts.find((c) => c.id === process.executorContactId) : null;
  const checks = latest ? await checkProcessVersion(process, latest) : [];
  return {
    ...base,
    clientName: client?.name ?? "",
    draftPrompt: client && !client.aiExcluded ? stepsDraftPrompt(client.name, process.code, process.title) : null,
    purpose: process.purpose,
    editing: latest ? { version: latest.version, status: latest.status } : null,
    runningVersion: running?.version ?? null,
    steps: latest ? (saved ? flowSteps(saved) : readSteps(latest.steps)) : [],
    isFlow: !!saved && saved.nodes.some((n) => n.kind === "CONDITION" || n.kind === "WAIT" || !!n.send),
    executor: executorUser ?? executorContact?.person.name ?? process.executorText ?? (process.ownerId ? staff.find((u) => u.id === process.ownerId)?.name ?? null : null),
    staff,
    people: contacts
      .map((c) => ({ id: c.id, name: [c.person.name, c.role].filter(Boolean).join(", ") || "איש קשר בלי שם", ended: !!c.endedAt }))
      .sort((a, b) => a.name.localeCompare(b.name, "he")),
    systems: systems.map((x) => ({ id: x.id, name: x.systemName })),
    mayApprove: approvesProceduresOf({ userId: actor.id, isManager: canManageClients(actor.role), accountManagerId: client?.accountManagerId ?? null }),
    ruled: checks
      .filter((c) => !c.excepted && !["R1", "R3", "R4"].includes(c.code) && c.severity === "BLOCK")
      .map((c) => ({ code: c.code, message: c.message, ...(c.step ? { step: c.step } : {}) })),
  };
}

/// "שמור והפעל" (task cmvtivumj000pjs08q9qj4t67, step 3 decisions, Ariel
/// 4.11.2026): the account manager saves and the version goes live at once,
/// through the same approval, checks, snapshot and audit as any approval.
/// It waits as a draft for a second pair of eyes when it sends mail to the
/// client on its own or moves money, when the client keeps authors from
/// approving their own procedures, or when the person saving does not
/// approve procedures of this client. The live version keeps running until
/// then. Never called for what Claude proposes: that stays a draft.
export type SaveAndActivateResult =
  | { live: true; version: number }
  | {
      live: false;
      version: number;
      reason: string;
      secondEye: string[];
      /// ADR 0006: why, for a screen in the reader's language
      /// (clients.processes.flow.reasons.<key>), or the refusal that held
      /// the approval back. `reason` stays the Hebrew.
      reasonKey?: "waitingSecondEye" | "notApprover" | "separation" | "notActivated";
      reasonError?: unknown;
    };

export async function saveAndActivateProcessVersion(actor: User, processId: string, input: VersionInput): Promise<SaveAndActivateResult> {
  const row = await saveProcessVersion(actor, processId, input);
  const process = await findProcess(actor, processId);
  const flow = readFlow(row.flow);
  const waiting = flow ? secondEyeNodes(flow).map((n) => n.title) : [];
  if (waiting.length) {
    return { live: false, version: row.version, secondEye: waiting, reason: `ממתין לעין שנייה: ${waiting.map((t) => `"${t}"`).join(", ")}. עד האישור, הגרסה הקודמת ממשיכה לרוץ.`, reasonKey: "waitingSecondEye" };
  }
  const client = await prisma.client.findUnique({ where: { id: process.clientId }, select: { accountManagerId: true, procedureApprovalSeparation: true } });
  const approver = { userId: actor.id, isManager: canManageClients(actor.role), accountManagerId: client?.accountManagerId ?? null };
  if (!approvesProceduresOf(approver)) {
    return { live: false, version: row.version, secondEye: [], reason: "נשמר כטיוטה: רק מנהל או מנהל התיק של הלקוח מפעילים נוהל.", reasonKey: "notApprover" };
  }
  if (procedureApprovalBlocker({ ...approver, separation: client?.procedureApprovalSeparation ?? false, authorId: row.createdById })) {
    return { live: false, version: row.version, secondEye: [], reason: "נשמר כטיוטה: אצל הלקוח הזה מי שכתב את הנוהל לא מאשר אותו, ולכן הוא ממתין לעין שנייה.", reasonKey: "separation" };
  }
  try {
    await approveProcessVersion(actor, processId, row.version);
  } catch (err) {
    // Saved, not live: the client's rules hold it (an approval threshold
    // with no approval step, say). The editor shows why.
    return { live: false, version: row.version, secondEye: [], reason: err instanceof Error ? err.message : "הנוהל נשמר כטיוטה ולא הופעל.", ...(err instanceof Error ? { reasonError: err } : { reasonKey: "notActivated" as const }) };
  }
  return { live: true, version: row.version };
}

/// The checks a version would face if approved now.
export async function checkProcessVersion(
  process: { clientId: string; entityId: string | null; externalPartyContactIds: string[] },
  v: { steps: unknown; highlights: string | null; outputs: string | null }
): Promise<ProcessCheckResult[]> {
  return processChecks({ steps: readSteps(v.steps), highlights: v.highlights, outputs: v.outputs }, process, await ruleContext(process.clientId));
}

export async function approveProcessVersion(actor: User, processId: string, version: number) {
  const process = await findProcess(actor, processId);
  // 31.10.2026: a manager, or the client's account manager; with the
  // client's separation on, not whoever wrote the version.
  const client = await prisma.client.findUnique({ where: { id: process.clientId }, select: { accountManagerId: true, procedureApprovalSeparation: true } });
  const approver = { userId: actor.id, isManager: canManageClients(actor.role), accountManagerId: client?.accountManagerId ?? null };
  if (!approvesProceduresOf(approver)) throw new DomainError("processes.notApprover", NOT_APPROVER);
  const latest = await prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" } });
  if (!latest || latest.version !== version) throw new DomainError("processes.notLatestVersion", "זו לא הגרסה האחרונה של הנוהל. רעננו ונסו שוב.");
  if (latest.status !== "DRAFT") throw new DomainError("processes.alreadyApproved", "הגרסה הזו כבר מאושרת.");
  const blocker = procedureApprovalBlocker({ ...approver, separation: client?.procedureApprovalSeparation ?? false, authorId: latest.createdById });
  if (blocker === NOT_APPROVER) throw new DomainError("processes.notApprover", NOT_APPROVER);
  if (blocker === SEPARATION_REQUIRED) throw new DomainError("processes.separationRequired", SEPARATION_REQUIRED);
  if (blocker) throw new Error(blocker);
  const checks = await checkProcessVersion(process, latest);
  const blocking = holdsApproval(checks);
  if (blocking.length) {
    const failing = blocking.map((b) => b.message).join(" ");
    throw new DomainError("processes.failsChecks", `הנוהל לא עובר את הבדיקות: ${failing}`, { checks: failing });
  }
  const now = new Date();
  // 23.10.2026: the document as approved, names and all, so version N
  // reads the same next year (lib/app-domain/procedure-documents.ts).
  const document = await buildSnapshot(processId, "approval", prisma, now);
  await prisma.$transaction([
    prisma.processVersion.updateMany({ where: { processId, status: "APPROVED" }, data: { status: "SUPERSEDED" } }),
    prisma.processVersion.update({
      where: { id: latest.id },
      data: { status: "APPROVED", approvedById: actor.id, approvedAt: now, approvalChecks: checks as unknown as Prisma.InputJsonValue, document: document as unknown as Prisma.InputJsonValue },
    }),
    prisma.process.update({
      where: { id: processId },
      data: { status: process.status === "DRAFT" ? "ACTIVE" : undefined, lastReviewedAt: now, needsReview: false, reviewReason: null },
    }),
  ]);
  await recordAudit({ actorId: actor.id, action: "process.version_approve", entityType: "Process", entityId: processId, clientId: process.clientId, after: { version, checks: checks.length } });
}

/// What approving a process proposal did to its procedure (3.11.2026):
/// approved with it, or why not, in words the screen shows. Null when
/// there was nothing to approve with it, or this person does not approve
/// procedures (then it waits as before, and nothing is said).
export type ProcedureAlongside = { approved: true; version: number } | { approved: false; reason: string };

/// The procedure version a process proposal just brought, approved in the
/// same act when this person approves procedures of the client and it
/// passes every check (lib/procedure-approval.ts). Only a draft this
/// person wrote after version `after` (the latest before the proposal was
/// applied: 0 for a new process), so an older draft someone else wrote is
/// never approved by the way. Never throws: the proposal is approved
/// already, and a procedure that is not stays a draft as before.
export async function approveProcedureAlongside(actor: User, processId: string, after: number): Promise<ProcedureAlongside | null> {
  try {
    const process = await prisma.process.findUnique({ where: { id: processId }, select: { clientId: true, entityId: true, externalPartyContactIds: true } });
    if (!process) return null;
    const client = await prisma.client.findUnique({ where: { id: process.clientId }, select: { accountManagerId: true, procedureApprovalSeparation: true } });
    const approver = { userId: actor.id, isManager: canManageClients(actor.role), accountManagerId: client?.accountManagerId ?? null };
    if (!approvesProceduresOf(approver)) return null;
    const latest = await prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" } });
    if (!latest || latest.status !== "DRAFT" || latest.createdById !== actor.id || latest.version <= after) return null;
    const blocker = procedureApprovalBlocker({ ...approver, separation: client?.procedureApprovalSeparation ?? false, authorId: latest.createdById });
    if (blocker) return { approved: false, reason: blocker };
    const blocking = holdsApproval(await checkProcessVersion(process, latest));
    if (blocking.length) return { approved: false, reason: `הנוהל לא עובר את הבדיקות: ${blocking.map((b) => b.message).join(" ")}` };
    await approveProcessVersion(actor, processId, latest.version);
    return { approved: true, version: latest.version };
  } catch (err) {
    return { approved: false, reason: err instanceof Error ? err.message : "אישור הנוהל נכשל. הוא ממתין לאישור בטאב נוהל." };
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ProcessView = Awaited<ReturnType<typeof listProcesses>>[number];

/// Names of the client's systems, for showing what a step or a process needs.
export async function systemNamesFor(actor: User, clientId: string): Promise<Record<string, string>> {
  await assertClientAccess(actor, clientId);
  const rows = await prisma.systemAccess.findMany({ where: { clientId, deletedAt: null }, select: { id: true, systemName: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.systemName]));
}

/// The contacts and firms of the client, by name, for finding the ones a
/// process names (lib/process-mentions.ts).
async function partiesOf(clientId: string): Promise<(Named & { kind: "contact" | "organization" })[]> {
  const [contacts, orgs] = await Promise.all([
    prisma.clientContact.findMany({ where: { clientId, deletedAt: null }, select: { id: true, person: { select: { name: true } } } }),
    prisma.clientOrganization.findMany({ where: { clientId, deletedAt: null }, select: { id: true, organization: { select: { name: true } } } }),
  ]);
  return [
    ...contacts.filter((c) => c.person.name?.trim()).map((c) => ({ id: c.id, name: c.person.name!, kind: "contact" as const })),
    ...orgs.filter((o) => o.organization.name?.trim()).map((o) => ({ id: o.id, name: o.organization.name, kind: "organization" as const })),
  ];
}

/// Marks a documentation field "לא רלוונטי", or takes the mark off
/// (25.10.2026). A manager or the process's owner. It stops counting, and
/// is never shown as a gap.
export async function setProcessFieldNotApplicable(actor: User, id: string, field: string, notApplicable: boolean) {
  const before = await findProcess(actor, id);
  if (!canManageClients(actor.role) && before.ownerId !== actor.id) throw new DomainError("processes.notApplicableNotAllowed", "רק מנהל או הבעלים של התהליך מסמנים שדה כלא רלוונטי.");
  if (!(NOT_APPLICABLE_FIELDS as readonly string[]).includes(field)) throw new DomainError("processes.notApplicableField", "את השדה הזה אי אפשר לסמן כלא רלוונטי.");
  const now = readNotApplicable(before.notApplicableFields);
  const next = notApplicable ? [...new Set([...now, field as NotApplicableField])] : now.filter((f) => f !== field);
  const updated = await prisma.process.update({ where: { id }, data: { notApplicableFields: next } });
  await recordAudit({
    actorId: actor.id,
    action: "process.field_not_applicable",
    entityType: "Process",
    entityId: id,
    clientId: before.clientId,
    before: { notApplicableFields: now },
    after: { notApplicableFields: next, field: FIELD_LABELS[field as NotApplicableField], notApplicable },
  });
  return updated;
}

/// Links a system the process names to its required systems, or a contact
/// it names to its outside parties: the one-click suggestions on the card.
export async function linkProcessMention(actor: User, id: string, kind: "system" | "contact", itemId: string) {
  const before = await findProcess(actor, id);
  if (kind === "system") {
    if (before.requiredSystemIds.includes(itemId)) return before;
    return updateProcess(actor, id, { requiredSystemIds: [...before.requiredSystemIds, itemId] });
  }
  if (before.externalPartyContactIds.includes(itemId)) return before;
  return updateProcess(actor, id, { externalPartyContactIds: [...before.externalPartyContactIds, itemId] });
}

/// When the run for this occurrence opens: the date's own lead, or earlier
/// when the earliest step needs it. The same rule as the daily job.
function runOpensAt(
  d: { nextOccurrenceAt: Date | null; autoTaskLeadDays: number | null; leadUnit: LeadUnit; businessCalendar: string; timezone: string },
  steps: ProcessStep[]
): Date | null {
  if (!d.nextOccurrenceAt) return null;
  const byDate = computeLeadDate(d.nextOccurrenceAt, d.autoTaskLeadDays ?? 0, d.leadUnit, d.businessCalendar, d.timezone);
  const bySteps = computeLeadDate(d.nextOccurrenceAt, runLeadBusinessDays(steps), "BUSINESS_DAYS", d.businessCalendar, d.timezone);
  return bySteps.getTime() < byDate.getTime() ? bySteps : byDate;
}

/// Every process of the client this person may see, with its current and
/// draft procedure, its dates, its completeness and its gaps.
export async function listProcesses(actor: User, clientId: string, options: { includeRetired?: boolean } = {}) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true } });
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const [rows, systems, ctx] = await Promise.all([
    prisma.process.findMany({
      where: { clientId, deletedAt: null, ...(options.includeRetired ? {} : { status: { not: "RETIRED" } }) },
      orderBy: { seq: "asc" },
      include: {
        versions: { orderBy: { version: "desc" } },
        dates: {
          where: { deletedAt: null },
          select: {
            id: true,
            title: true,
            nextOccurrenceAt: true,
            status: true,
            autoTaskLeadDays: true,
            leadUnit: true,
            businessCalendar: true,
            timezone: true,
            recurrence: true,
            month: true,
            day: true,
            weekday: true,
            intervalMonths: true,
            onceDate: true,
            rollConvention: true,
          },
        },
        starts: { orderBy: { sortOrder: "asc" } },
      },
    }),
    prisma.systemAccess.findMany({ where: { clientId, deletedAt: null }, select: { id: true, systemName: true, accessStatus: true } }),
    ruleContext(clientId, { canSee: (r) => canSeeKnowledgeItem(r, viewer, client?.accountManagerId ?? null) }),
  ]);
  const systemById = new Map(systems.map((s) => [s.id, s]));
  const parties = await partiesOf(clientId);
  return rows
    .filter((r) => canSeeKnowledgeItem(r, viewer, client?.accountManagerId ?? null))
    .map((r) => {
      const current = r.versions.find((v) => v.status === "APPROVED") ?? null;
      const latest = r.versions[0] ?? null;
      const draft = latest && latest.status === "DRAFT" ? latest : null;
      const nextOf =
        r.dates
          .filter((d) => d.status !== "ARCHIVED" && d.nextOccurrenceAt)
          .sort((a, b) => a.nextOccurrenceAt!.getTime() - b.nextOccurrenceAt!.getTime())[0] ?? null;
      const nextDate = nextOf?.nextOccurrenceAt ?? null;
      // 13.11.2026 (processes redesign, stage 0): the day the next run
      // opens, counted as the daily job counts it (createDueAutoTasks), so
      // "הבא" is the date itself and this says when the work starts.
      const nextOpensAt = nextOf && current ? runOpensAt(nextOf, readSteps(current.steps)) : null;
      const stepSystems = [...new Set((current ? readSteps(current.steps) : []).flatMap((s) => s.systemIds))];
      const needed = [...new Set([...r.requiredSystemIds, ...stepSystems])];
      const steps = (v: typeof current): ProcessStep[] => (v ? readSteps(v.steps) : []);
      // 25.10.2026: what its own words already name, offered to link.
      const texts = processTexts({ ...r, steps: [...steps(current), ...steps(draft)] });
      const systemSuggestions = mentionedIn(
        texts,
        systems.filter((s) => !needed.includes(s.id)).map((s) => ({ id: s.id, name: s.systemName }))
      );
      const partyMentions = mentionedIn(texts, parties);
      const contactSuggestions = partyMentions.filter((x) => x.kind === "contact" && !r.externalPartyContactIds.includes(x.id));
      const input = {
        ...r,
        systemsWithoutAccess: needed.filter((id) => {
          const s = systemById.get(id);
          return !s || (s.accessStatus !== "HAS_ACCESS" && s.accessStatus !== "NOT_NEEDED");
        }),
        nextDate,
        mentionedExternal: partyMentions.length > 0,
      };
      return {
        ...r,
        // The approved procedure against today's rules: a rule added or
        // changed since the approval shows here, on the procedure that runs.
        current: current ? { ...current, steps: steps(current), checks: processChecks({ steps: steps(current), highlights: current.highlights, outputs: current.outputs }, r, ctx) } : null,
        draft: draft ? { ...draft, steps: steps(draft), checks: processChecks({ steps: steps(draft), highlights: draft.highlights, outputs: draft.outputs }, r, ctx) } : null,
        latestVersion: latest?.version ?? 0,
        /// The newest version was built as a flow: it is edited in the flow
        /// editor only (FLOW_ONLY_MESSAGE).
        isFlow: !!(latest && readFlow(latest.flow)),
        nextDate,
        nextOpensAt,
        /// 13.11.2026 (stage 1): the rhythm in one sentence, from its starts.
        /// Empty starts: what triggerText said before stage 1.
        rhythm: r.starts.length ? describeRhythm(r.starts, r.dates) : r.triggerText,
        completeness: completeness(input),
        documentation: documentation(input),
        readiness: runReadiness({ ...r, nextDate }),
        notApplicable: readNotApplicable(r.notApplicableFields),
        /// Named in its own words, not linked yet: one click links each.
        suggestions: {
          systems: systemSuggestions.map((x) => ({ id: x.id, name: x.name })),
          contacts: contactSuggestions.map((x) => ({ id: x.id, name: x.name })),
        },
        gaps: processGaps(input, (id) => systemById.get(id)?.systemName ?? "מערכת שהוסרה"),
        /// 22.10.2026: the systems it needs and cannot use, by id and name,
        /// for the step that asks for access.
        noAccess: input.systemsWithoutAccess.map((id) => ({ id, name: systemById.get(id)?.systemName ?? "מערכת שהוסרה" })),
      };
    });
}


/// Where the client's rules disagree with the file itself, for this
/// person: systems whose invoice goes elsewhere (R16), and request types
/// routed across a separation (R8). Keyed by the item's id.
export async function ruleWarnings(actor: User, clientId: string): Promise<{ systems: Record<string, string[]>; requestTypes: Record<string, string[]> }> {
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true } });
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const [ctx, systems, types] = await Promise.all([
    ruleContext(clientId, { canSee: (r) => canSeeKnowledgeItem(r, viewer, client?.accountManagerId ?? null) }),
    prisma.systemAccess.findMany({
      where: { clientId, deletedAt: null },
      select: { id: true, systemName: true, invoiceTo: true, entityId: true, billingCycle: true, billingCostMinor: true },
    }),
    prisma.requestType.findMany({ where: { clientId, deletedAt: null }, select: { id: true, title: true, entityId: true, routeToContactIds: true } }),
  ]);
  const push = (map: Record<string, string[]>, id: string, message: string) => (map[id] ??= []).push(message);
  const out = { systems: {} as Record<string, string[]>, requestTypes: {} as Record<string, string[]> };
  for (const g of invoiceGaps(
    systems.map((s) => ({ ...s, billed: !!s.billingCycle || s.billingCostMinor !== null })),
    ctx.rules
  )) {
    push(out.systems, g.systemId, g.message);
  }
  for (const c of requestTypeConflicts(
    types.map((t) => ({ ...t, routes: t.routeToContactIds.map((id) => ctx.contacts.get(id)).filter((x): x is { name: string; entityId: string | null } => !!x) })),
    ctx.rules
  )) {
    push(out.requestTypes, c.requestTypeId, c.message);
  }
  return out;
}
