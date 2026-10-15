import "server-only";
import { Prisma } from "@prisma/client";
import type { ProcessStatus, ProcessTransition, ProcessTrigger, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSeeKnowledgeItem } from "@/lib/knowledge";
import { findSecrets } from "@/lib/secret-scan";
import { checkEveryError } from "@/lib/process-checks";
import { checkProcedure, readFindings, reviewContext } from "@/lib/app-domain/process-review";
import {
  MAX_PROCESS_STEPS,
  blockingChecks,
  completeness,
  processGaps,
  readSteps,
  type CheckResult,
  type ProcessStep,
} from "@/lib/process-rules";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { assertEntityBelongs } from "@/lib/app-domain/client-entities";
import { assertResolvable, knowledgeData, sourcedFields, type KnowledgeInput } from "@/lib/app-domain/knowledge-items";

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
  ownerId?: string | null;
  backupOwnerId?: string | null;
  slaText?: string | null;
  slaBusinessDays?: number | null;
  externalPartyContactIds?: string[];
  externalPartyText?: string | null;
  requiredSystemIds?: string[];
  approverText?: string | null;
  approverContactId?: string | null;
  approvalPolicyIds?: string[];
  approvalText?: string | null;
  exceptionPlaybook?: string | null;
  entityId?: string | null;
  executorText?: string | null;
  transitionStatus?: ProcessTransition;
  /// An ongoing process only: a check every N days, and what is checked.
  checkEveryDays?: number | null;
  checkText?: string | null;
}

export class ProcessVersionConflictError extends Error {
  constructor(public latest: number) {
    super(`מישהו שמר גרסה חדשה של הנוהל (גרסה ${latest}) בזמן שערכת. רעננו, ובדקו מה השתנה לפני ששומרים.`);
  }
}

const clean = (v: string | null | undefined) => v?.trim() || null;

async function assertIdsBelong(clientId: string, input: Partial<ProcessInput>) {
  const check = async (ids: string[] | undefined, count: (ids: string[]) => Promise<number>, what: string) => {
    const unique = [...new Set((ids ?? []).filter(Boolean))];
    if (unique.length && (await count(unique)) !== unique.length) throw new Error(`${what} שנבחר לא נמצא בתיק של הלקוח.`);
    return ids === undefined ? undefined : unique;
  };
  const contacts = await check(input.externalPartyContactIds, (ids) => prisma.clientContact.count({ where: { id: { in: ids }, clientId, deletedAt: null } }), "איש קשר");
  const systems = await check(input.requiredSystemIds, (ids) => prisma.systemAccess.count({ where: { id: { in: ids }, clientId, deletedAt: null } }), "מערכת");
  const policies = await check(input.approvalPolicyIds, (ids) => prisma.clientPolicy.count({ where: { id: { in: ids }, clientId, deletedAt: null } }), "כלל");
  if (input.approverContactId) await check([input.approverContactId], (ids) => prisma.clientContact.count({ where: { id: { in: ids }, clientId, deletedAt: null } }), "המאשר");
  for (const id of [input.ownerId, input.backupOwnerId].filter((x): x is string => !!x)) {
    const ok = await prisma.user.count({ where: { id, deletedAt: null, role: { not: "CLIENT_USER" } } });
    if (!ok) throw new Error("אחראי או מחליף צריכים להיות אנשי צוות של אנקורה.");
  }
  if (input.entityId !== undefined) await assertEntityBelongs(clientId, input.entityId);
  return { contacts, systems, policies };
}

function fields(input: Partial<ProcessInput>, ids: { contacts?: string[]; systems?: string[]; policies?: string[] }) {
  if (input.slaBusinessDays !== undefined && input.slaBusinessDays !== null && (!Number.isInteger(input.slaBusinessDays) || input.slaBusinessDays < 0 || input.slaBusinessDays > 60)) {
    throw new Error("ה-SLA בימי עסקים הוא מספר שלם בין 0 ל-60.");
  }
  return {
    title: input.title !== undefined ? input.title.trim() : undefined,
    purpose: input.purpose !== undefined ? clean(input.purpose) : undefined,
    triggerKinds: input.triggerKinds !== undefined ? [...new Set(input.triggerKinds)] : undefined,
    triggerText: input.triggerText !== undefined ? clean(input.triggerText) : undefined,
    ownerId: input.ownerId !== undefined ? input.ownerId || null : undefined,
    backupOwnerId: input.backupOwnerId !== undefined ? input.backupOwnerId || null : undefined,
    slaText: input.slaText !== undefined ? clean(input.slaText) : undefined,
    slaBusinessDays: input.slaBusinessDays !== undefined ? input.slaBusinessDays : undefined,
    externalPartyContactIds: ids.contacts,
    externalPartyText: input.externalPartyText !== undefined ? clean(input.externalPartyText) : undefined,
    requiredSystemIds: ids.systems,
    approverText: input.approverText !== undefined ? clean(input.approverText) : undefined,
    approverContactId: input.approverContactId !== undefined ? input.approverContactId || null : undefined,
    approvalPolicyIds: ids.policies,
    approvalText: input.approvalText !== undefined ? clean(input.approvalText) : undefined,
    exceptionPlaybook: input.exceptionPlaybook !== undefined ? clean(input.exceptionPlaybook) : undefined,
    entityId: input.entityId !== undefined ? input.entityId || null : undefined,
    executorText: input.executorText !== undefined ? clean(input.executorText) : undefined,
    transitionStatus: input.transitionStatus ?? undefined,
    checkEveryDays: input.checkEveryDays !== undefined ? input.checkEveryDays : undefined,
    checkText: input.checkText !== undefined ? clean(input.checkText) : undefined,
  };
}

/// A check belongs to an ongoing process: a scheduled one has its dates,
/// and a check on top of them would be a second clock nobody reads.
function assertCheck(triggerKinds: ProcessTrigger[], checkEveryDays: number | null | undefined) {
  const error = checkEveryError(checkEveryDays);
  if (error) throw new Error(error);
  if (checkEveryDays && !triggerKinds.includes("CONTINUOUS")) throw new Error("בדיקה תקופתית היא לתהליך שוטף.");
}

function assertNoSecrets(input: Partial<ProcessInput>) {
  const text = [input.title, input.purpose, input.triggerText, input.slaText, input.externalPartyText, input.approverText, input.approvalText, input.exceptionPlaybook, input.executorText, input.checkText]
    .filter(Boolean)
    .join("\n");
  if (findSecrets(text).length) throw new Error("יש כאן סיסמה, מפתח או מספר כרטיס. סודות נשמרים בכספת, לא בתיק.");
}

async function findProcess(actor: User, id: string) {
  const row = await prisma.process.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw new Error("התהליך לא נמצא.");
  await assertClientAccess(actor, row.clientId);
  return row;
}

export async function addProcess(actor: User, input: ProcessInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  if (!input.title?.trim()) throw new Error("צריך שם לתהליך.");
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
  if (input.title !== undefined && !input.title.trim()) throw new Error("צריך שם לתהליך.");
  assertNoSecrets(input);
  assertCheck(input.triggerKinds ?? before.triggerKinds, input.checkEveryDays !== undefined ? input.checkEveryDays : before.checkEveryDays);
  assertResolvable(input.knowledgeStatus ?? before.knowledgeStatus, input.toResolve !== undefined ? input.toResolve : before.toResolve);
  const ids = await assertIdsBelong(before.clientId, input);
  const sourced = await sourcedFields(before.clientId, input, [input.purpose ?? before.purpose, input.triggerText ?? before.triggerText], before);
  const updated = await prisma.process.update({ where: { id }, data: { ...fields(input, ids), ...knowledgeData(input), ...sourced } });
  await recordAudit({ actorId: actor.id, action: "process.update", entityType: "Process", entityId: id, clientId: before.clientId, before, after: updated });
  return updated;
}

/// Pause, resume or retire. A manager's call: a paused process opens no
/// runs.
export async function setProcessStatus(actor: User, id: string, status: Exclude<ProcessStatus, "DRAFT">) {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל משהה, מחדש או מבטל תהליך.");
  const before = await findProcess(actor, id);
  if (status === "ACTIVE") {
    const approved = await prisma.processVersion.count({ where: { processId: id, status: "APPROVED" } });
    if (!approved) throw new Error("לתהליך עוד אין נוהל מאושר.");
  }
  const updated = await prisma.process.update({ where: { id }, data: { status } });
  await recordAudit({ actorId: actor.id, action: "process.status", entityType: "Process", entityId: id, clientId: before.clientId, before: { status: before.status }, after: { status } });
  return updated;
}

/// A process written by mistake, before any procedure was approved. One
/// that ran is retired instead, so its history stays.
export async function removeProcess(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const row = await findProcess(actor, id);
  if (row.status !== "DRAFT") throw new Error("תהליך שהיה לו נוהל מאושר לא נמחק. מבטלים אותו, והוא נשאר בהיסטוריה.");
  await prisma.importantDate.updateMany({ where: { processId: id }, data: { processId: null } });
  const removed = await prisma.process.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "process.remove", entityType: "Process", entityId: id, clientId: row.clientId, before: row });
  return removed;
}

/// The dates that start this process (spec 3.10): this client's dates
/// only. Replaces the set.
export async function linkProcessDates(actor: User, processId: string, dateIds: string[]) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await findProcess(actor, processId);
  const unique = [...new Set(dateIds.filter(Boolean))];
  const found = await prisma.importantDate.count({ where: { id: { in: unique }, clientId: process.clientId, deletedAt: null } });
  if (found !== unique.length) throw new Error("מועד שנבחר לא נמצא אצל הלקוח.");
  await prisma.$transaction([
    prisma.importantDate.updateMany({ where: { processId, id: { notIn: unique } }, data: { processId: null } }),
    prisma.importantDate.updateMany({ where: { id: { in: unique } }, data: { processId } }),
  ]);
  await recordAudit({ actorId: actor.id, action: "process.dates", entityType: "Process", entityId: processId, clientId: process.clientId, after: { dateIds: unique } });
}

// ---------------------------------------------------------------------------
// The procedure, in versions
// ---------------------------------------------------------------------------

export type VersionInput = {
  steps: unknown;
  highlights?: string | null;
  outputs?: string | null;
  changeNote?: string | null;
  /// The version this edit started from; 0 for the first.
  baseVersion: number;
};

export async function saveProcessVersion(actor: User, processId: string, input: VersionInput) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await findProcess(actor, processId);
  const steps = readSteps(input.steps);
  if (steps.length === 0) throw new Error("נוהל צריך לפחות שלב אחד.");
  if (steps.length > MAX_PROCESS_STEPS) throw new Error(`עד ${MAX_PROCESS_STEPS} שלבים. נוהל ארוך מזה הוא כמה תהליכים.`);
  const systemIds = [...new Set(steps.flatMap((s) => s.systemIds))];
  if (systemIds.length) {
    const found = await prisma.systemAccess.count({ where: { id: { in: systemIds }, clientId: process.clientId, deletedAt: null } });
    if (found !== systemIds.length) throw new Error("מערכת שנבחרה בשלב לא נמצאת במפת המערכות של הלקוח.");
  }
  const version = { steps, highlights: clean(input.highlights), outputs: clean(input.outputs) };
  // A secret blocks the save itself, not only the approval (R4): a draft
  // is stored, and stored is enough to leak.
  const secret = blockingChecks(version, []).find((c) => c.code === "R4");
  if (secret) throw new Error(secret.message);

  const latest = await prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" }, select: { version: true } });
  const latestVersion = latest?.version ?? 0;
  if (latestVersion !== input.baseVersion) throw new ProcessVersionConflictError(latestVersion);
  try {
    const row = await prisma.processVersion.create({
      data: {
        processId,
        version: latestVersion + 1,
        steps: steps as unknown as Prisma.InputJsonValue,
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

/// The checks a version would face if approved now: R1 to R4, and the
/// client's rules unless an exception to the rule is in force.
export async function checkProcessVersion(
  clientId: string,
  process: { entityId: string | null },
  v: { steps: unknown; highlights: string | null; outputs: string | null }
): Promise<CheckResult[]> {
  const ctx = await reviewContext(clientId);
  return checkProcedure(ctx, process, { steps: readSteps(v.steps), highlights: v.highlights, outputs: v.outputs }).failing;
}

export async function approveProcessVersion(actor: User, processId: string, version: number) {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל מאשר נוהל.");
  const process = await findProcess(actor, processId);
  const latest = await prisma.processVersion.findFirst({ where: { processId }, orderBy: { version: "desc" } });
  if (!latest || latest.version !== version) throw new Error("זו לא הגרסה האחרונה של הנוהל. רעננו ונסו שוב.");
  if (latest.status !== "DRAFT") throw new Error("הגרסה הזו כבר מאושרת.");
  const blocking = await checkProcessVersion(process.clientId, process, latest);
  if (blocking.length) throw new Error(`הנוהל לא עובר את הבדיקות: ${blocking.map((b) => b.message).join(" ")}`);
  const now = new Date();
  await prisma.$transaction([
    prisma.processVersion.updateMany({ where: { processId, status: "APPROVED" }, data: { status: "SUPERSEDED" } }),
    prisma.processVersion.update({ where: { id: latest.id }, data: { status: "APPROVED", approvedById: actor.id, approvedAt: now } }),
    prisma.process.update({
      where: { id: processId },
      data: { status: process.status === "DRAFT" ? "ACTIVE" : undefined, lastReviewedAt: now, needsReview: false, reviewFindings: [] },
    }),
  ]);
  await recordAudit({ actorId: actor.id, action: "process.version_approve", entityType: "Process", entityId: processId, clientId: process.clientId, after: { version } });
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
        dates: { where: { deletedAt: null }, select: { id: true, title: true, nextOccurrenceAt: true, status: true } },
      },
    }),
    prisma.systemAccess.findMany({ where: { clientId, deletedAt: null }, select: { id: true, systemName: true, accessStatus: true } }),
    reviewContext(clientId),
  ]);
  const systemById = new Map(systems.map((s) => [s.id, s]));
  return rows
    .filter((r) => canSeeKnowledgeItem(r, viewer, client?.accountManagerId ?? null))
    .map((r) => {
      const current = r.versions.find((v) => v.status === "APPROVED") ?? null;
      const latest = r.versions[0] ?? null;
      const draft = latest && latest.status === "DRAFT" ? latest : null;
      const nextDate =
        r.dates
          .filter((d) => d.status !== "ARCHIVED" && d.nextOccurrenceAt)
          .map((d) => d.nextOccurrenceAt!)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const stepSystems = [...new Set((current ? readSteps(current.steps) : []).flatMap((s) => s.systemIds))];
      const needed = [...new Set([...r.requiredSystemIds, ...stepSystems])];
      const input = {
        ...r,
        systemsWithoutAccess: needed.filter((id) => {
          const s = systemById.get(id);
          return !s || (s.accessStatus !== "HAS_ACCESS" && s.accessStatus !== "NOT_NEEDED");
        }),
        nextDate,
      };
      const steps = (v: typeof current): ProcessStep[] => (v ? readSteps(v.steps) : []);
      const draftChecks = (d: NonNullable<typeof draft>) => {
        const c = checkProcedure(ctx, r, { steps: steps(d), highlights: d.highlights, outputs: d.outputs });
        return { checks: c.failing, excepted: c.excepted.map((f) => ({ code: f.code, message: f.message })) };
      };
      return {
        ...r,
        current: current ? { ...current, steps: steps(current) } : null,
        draft: draft ? { ...draft, steps: steps(draft), ...draftChecks(draft) } : null,
        reviewFindings: readFindings(r.reviewFindings),
        latestVersion: latest?.version ?? 0,
        nextDate,
        completeness: completeness(input),
        gaps: processGaps(input, (id) => systemById.get(id)?.systemName ?? "מערכת שהוסרה"),
      };
    });
}
