import "server-only";
import { Prisma, type EntryOrigin, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { createTask, removeTaskSteps } from "@/lib/app-domain/tasks";
import { TaskPlanRuleError, normalizePlanBody, normalizePlanSteps, planVersionConflict } from "@/lib/task-plan-rules";

// "קדם עם קלוד" (10.10.2026): the work plan of a task.
//
// The flow this serves: a person presses "קדם עם קלוד" on a task, pastes
// the prompt into Claude, and Claude writes a plan with them. When they
// agree, Claude saves it here through the MCP server (save_task_plan).
// Later, in the same conversation or a new one, Claude reads it back
// (get_task_plan), revises it, or carries it out. The task screen shows
// it, lets a person edit it, approve a draft, and turn its proposed steps
// into the task's real steps.
//
// Every write goes through this file, from both callers, so the rules are
// the same whoever writes: access is client access (exactly like tasks,
// there is no plan.* permission), plans live on tasks and not on steps,
// a closed task's plan is history, and a save that was written against an
// older version than the one stored is refused rather than applied.

/// Versions shown in the history on the task screen and returned by MCP.
/// A plan that has been rewritten more than this has a different problem.
const MAX_VERSIONS_READ = 20;

export const PLAN_ON_STEP_MESSAGE = "לשלב אין תוכנית עבודה משלו. התוכנית נשמרת על המשימה שהשלב שייך אליה.";
export const PLAN_ON_CLOSED_MESSAGE = "המשימה כבר נסגרה, אז התוכנית שלה נשארת כמו שהייתה. אפשר לפתוח את המשימה מחדש ואז לעדכן.";
export const NO_PLAN_MESSAGE = "למשימה הזו עדיין אין תוכנית עבודה.";
export const PLAN_NOT_APPROVED_MESSAGE = "התוכנית עדיין טיוטה. אפשר להפוך לשלבים רק תוכנית מאושרת.";
export const PLAN_HAS_NO_STEPS_MESSAGE = "בתוכנית הזו אין שלבים להעתיק.";
export const PLAN_NOT_LATEST_MESSAGE = "זו לא הגרסה האחרונה של התוכנית. רעננו ונסו שוב.";
export const PLAN_ALREADY_APPROVED_MESSAGE = "התוכנית הזו כבר מאושרת.";

/// Somebody saved a newer version between the read and this write.
///
/// Carries the version that is stored now, so the caller can show it (the
/// screen) or hand it back to the model to merge (MCP) instead of saying
/// only that something went wrong.
export class PlanVersionConflictError extends Error {
  constructor(public readonly latestVersion: number) {
    super(
      `בינתיים נשמרה גרסה חדשה יותר של התוכנית (גרסה ${latestVersion}). יש לקרוא אותה, לשלב בה את השינויים ולשמור שוב.`
    );
    this.name = "PlanVersionConflictError";
  }
}

const PLAN_SELECT = {
  id: true,
  version: true,
  body: true,
  steps: true,
  status: true,
  origin: true,
  changeNote: true,
  createdAt: true,
  approvedAt: true,
  stepsAppliedAt: true,
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} satisfies Prisma.TaskPlanSelect;

export type TaskPlanRow = Prisma.TaskPlanGetPayload<{ select: typeof PLAN_SELECT }>;

/// The task a plan belongs to, if this person may reach it. Null for "no
/// such task" and for "not your client" alike, for the same reason
/// getTaskDetail does it: a different answer for the second would confirm
/// that the task exists.
async function reachableTask(actor: User, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: { id: true, title: true, clientId: true, parentId: true, status: true },
  });
  if (!task) return null;
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === task.clientId)) return null;
  return task;
}

async function writableTask(actor: User, taskId: string) {
  assertCan(actor.role, "time_entry.create_self");
  const task = await reachableTask(actor, taskId);
  if (!task) throw new ForbiddenError("You are not assigned to this client.");
  if (task.parentId) throw new TaskPlanRuleError(PLAN_ON_STEP_MESSAGE);
  if (task.status === "DONE" || task.status === "ARCHIVED") throw new TaskPlanRuleError(PLAN_ON_CLOSED_MESSAGE);
  return task;
}

/// The current plan of a task and the versions before it, newest first.
/// Null when the task is out of reach.
export async function getTaskPlans(actor: User, taskId: string) {
  assertCan(actor.role, "time_entry.create_self");
  const task = await reachableTask(actor, taskId);
  if (!task) return null;
  const versions = await prisma.taskPlan.findMany({
    where: { taskId: task.id },
    orderBy: { version: "desc" },
    take: MAX_VERSIONS_READ,
    select: PLAN_SELECT,
  });
  return { current: versions[0] ?? null, versions };
}

/// Stores a new version of a task's plan.
///
/// `approved` is a statement by the person behind `actor`: through MCP it
/// means they agreed to this plan in the conversation, on the screen it
/// means they pressed save on their own edit. Either way the approval is
/// recorded in their name, because identity comes from the session or the
/// connection and never from an argument.
///
/// `baseVersion` is the version the writer read: 0 when there was none.
/// See planVersionConflict for why a mismatch is refused.
export async function saveTaskPlan(
  actor: User,
  taskId: string,
  input: {
    body: string;
    steps?: readonly string[] | null;
    approved: boolean;
    baseVersion?: number | null;
    changeNote?: string | null;
    origin: EntryOrigin;
  }
): Promise<TaskPlanRow> {
  const task = await writableTask(actor, taskId);
  const body = normalizePlanBody(input.body);
  const steps = normalizePlanSteps(input.steps);
  const changeNote = input.changeNote?.trim().slice(0, 300) || null;

  let saved: TaskPlanRow;
  try {
    saved = await prisma.$transaction(async (tx) => {
      const latest = await tx.taskPlan.findFirst({
        where: { taskId: task.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const latestVersion = latest?.version ?? 0;
      if (planVersionConflict(latestVersion, input.baseVersion)) {
        throw new PlanVersionConflictError(latestVersion);
      }
      const now = new Date();
      return tx.taskPlan.create({
        data: {
          taskId: task.id,
          version: latestVersion + 1,
          body,
          steps,
          status: input.approved ? "APPROVED" : "DRAFT",
          origin: input.origin,
          changeNote,
          createdById: actor.id,
          approvedById: input.approved ? actor.id : null,
          approvedAt: input.approved ? now : null,
        },
        select: PLAN_SELECT,
      });
    });
  } catch (err) {
    // Two saves that both passed the check at the same instant: the
    // unique (taskId, version) index lets one through and refuses the
    // other, which is then the same situation as a stale read.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const latest = await prisma.taskPlan.findFirst({
        where: { taskId: task.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      throw new PlanVersionConflictError(latest?.version ?? 0);
    }
    throw err;
  }

  await recordAudit({
    actorId: actor.id,
    action: "task.plan_saved",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: { planVersion: saved.version, planStatus: saved.status, origin: saved.origin, stepCount: steps.length },
  });
  return saved;
}

/// Agrees to a draft. Only the latest version can be approved: approving
/// an older one would be agreeing to something that has already been
/// rewritten.
export async function approveTaskPlan(actor: User, taskId: string, version: number): Promise<TaskPlanRow> {
  const task = await writableTask(actor, taskId);
  const latest = await prisma.taskPlan.findFirst({
    where: { taskId: task.id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true },
  });
  if (!latest) throw new TaskPlanRuleError(NO_PLAN_MESSAGE);
  if (latest.version !== version) throw new TaskPlanRuleError(PLAN_NOT_LATEST_MESSAGE);
  if (latest.status === "APPROVED") throw new TaskPlanRuleError(PLAN_ALREADY_APPROVED_MESSAGE);

  const approved = await prisma.taskPlan.update({
    where: { id: latest.id },
    data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date() },
    select: PLAN_SELECT,
  });
  await recordAudit({
    actorId: actor.id,
    action: "task.plan_approved",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: { planVersion: approved.version },
  });
  return approved;
}

/// Makes the current plan's proposed steps the task's steps.
///
/// The same replacement replace_task_steps does, and with the same
/// promise: a step already done, and a step with time logged against it,
/// are kept and reported, never removed. A kept step whose title is in the
/// plan stays as that step rather than appearing twice. Every other open
/// step is removed, because the plan is now the description of the work.
export async function applyPlanSteps(actor: User, taskId: string) {
  const task = await writableTask(actor, taskId);
  const plan = await prisma.taskPlan.findFirst({
    where: { taskId: task.id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, steps: true },
  });
  if (!plan) throw new TaskPlanRuleError(NO_PLAN_MESSAGE);
  if (plan.status !== "APPROVED") throw new TaskPlanRuleError(PLAN_NOT_APPROVED_MESSAGE);
  if (plan.steps.length === 0) throw new TaskPlanRuleError(PLAN_HAS_NO_STEPS_MESSAGE);

  const existing = await prisma.task.findMany({
    // subtasks-included: the-steps-to-replace. The steps of one parent,
    // read only to hand their ids to removeTaskSteps.
    where: { parentId: task.id, deletedAt: null },
    select: { id: true },
  });
  const result = await removeTaskSteps(
    actor,
    task.id,
    existing.map((s) => s.id)
  );

  const keptTitles = new Set(result.kept.map((s) => s.title.trim()));
  const added: string[] = [];
  for (const title of plan.steps) {
    if (keptTitles.has(title.trim())) continue;
    await createTask(actor, { clientId: task.clientId, title, parentId: task.id });
    added.push(title);
  }

  await prisma.taskPlan.update({ where: { id: plan.id }, data: { stepsAppliedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "task.plan_steps_applied",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: { planVersion: plan.version, added: added.length, kept: result.kept.length, removed: result.removed.length },
  });
  return { version: plan.version, removed: result.removed, kept: result.kept, added };
}
