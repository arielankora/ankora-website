import "server-only";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, assertCan, can, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import type { SupplierExperience, User, TaskStatus, UserRole } from "@prisma/client";

// Phase 9 gap-fix (docs/adr/0001 section 17.2): spec section 11's
// dedicated "Tasks" screen - open/recent tasks, filterable by client/
// category/status - never existed; a Task previously only ever came into
// being (in theory - Phase 2's actual UI never even wired the picker) as
// an inline create-or-pick inside the timer/manual-entry forms. This file
// is the first real domain logic for standalone Task CRUD.
//
// Scoping follows the exact precedent set by lib/app-domain/time-entries.ts
// and the timer/manual-entry client picker: no dedicated task.* permission
// exists (none was added to permissions.ts - see that file's Phase 9
// comment) because "can this user see/act on this task" reduces entirely
// to "can this user see/act on this task's client," which
// listAccessibleClients() (spec 4.1: "אסור לעובד לדווח זמן ללקוח שאינו
// משויך אליו") already answers for the timer/reports screens. An admin
// (canManageClients) sees/creates tasks for every active client; anyone
// else only for clients they hold a UserClientAccess row for.
//
// ---------------------------------------------------------------------
// Phase 16 (MCP tasks, docs/adr/0005): this file was finished.
//
// Phase 10 added Task.assignedToId and Task.dueDate to the schema, and
// wired lib/app-domain/important-dates-job.ts to WRITE both when it
// auto-creates a task from an important date. Nothing was ever added here
// to read or change them. The result was a real hole, not a cosmetic one:
// production tasks carry an owner and a deadline that no screen, no
// server action and no API could show or amend - the only mutation in
// this file was a status flip. "What is on my plate today" and "what is
// overdue" were unanswerable from the data we were already storing.
//
// So the additions below are not MCP plumbing. They are the domain
// functions the Tasks screen should have had since Phase 10; the MCP
// tools in lib/mcp/tasks-tools.ts are one caller of them, and the screen
// is another.
//
// One rule is new here and worth stating outright: an assignee must be
// someone who can actually see the task. Task visibility is derived from
// client access, so assigning a client's task to a colleague with no
// access to that client would file it where its owner can never find it -
// a silent dead letter. assertAssignable() below refuses that.

/// The status pair that means "not finished". Used for the default MCP
/// task list and for `onlyOpen` - DONE and ARCHIVED are history, and a
/// model asked "what is open" should not have to know the enum.
export const OPEN_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS"];

/// The roles that reach every active client without a UserClientAccess
/// row - derived from the permission rather than written out, so it
/// cannot drift from canManageClients()/listAccessibleClients(). Needed
/// as a list (not a predicate) because it goes into a Prisma `where`.
/// A role added to the enum but not to this literal is simply excluded,
/// which is the safe direction to fail.
const ALL_ROLES: UserRole[] = ["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE", "CLIENT_USER"];
const MANAGING_ROLES: UserRole[] = ALL_ROLES.filter(canManageClients);

export type TaskFilters = {
  clientId?: string;
  categoryId?: string;
  status?: TaskStatus;
  /// Several statuses at once. Ignored when `status` is set.
  statusIn?: TaskStatus[];
  /// Only tasks assigned to this user. Pass the actor's own id for "mine".
  assignedToId?: string;
  /// Only tasks that HAVE a due date, at or before this instant.
  dueBefore?: Date;
  /// Only tasks with no assignee. Cannot be combined with assignedToId.
  unassigned?: boolean;
};

export async function listTasks(actor: User, filters: TaskFilters = {}) {
  const accessible = await listAccessibleClients(actor);
  const accessibleIds = accessible.map((c) => c.id);
  if (accessibleIds.length === 0) return [];

  const clientId = filters.clientId && accessibleIds.includes(filters.clientId) ? filters.clientId : undefined;

  // `status` wins over `statusIn` so the existing screen's single-status
  // pills keep behaving exactly as before.
  const status = filters.status
    ? filters.status
    : filters.statusIn && filters.statusIn.length > 0
      ? { in: filters.statusIn }
      : undefined;

  return prisma.task.findMany({
    where: {
      deletedAt: null,
      clientId: clientId ?? { in: accessibleIds },
      categoryId: filters.categoryId || undefined,
      status,
      assignedToId: filters.unassigned ? null : filters.assignedToId || undefined,
      // `not: null` is not redundant next to `lte`: without it a task with
      // no due date would be excluded anyway, but stating it keeps the
      // intent readable and survives someone adding an `OR` here later.
      dueDate: filters.dueBefore ? { not: null, lte: filters.dueBefore } : undefined,
    },
    include: { client: true, category: true, assignedTo: true },
    // Open/In-progress first (spec §11: "open/recent tasks"), then by
    // deadline, then newest first. The dueDate leg is Phase 16: with due
    // dates finally readable, "soonest deadline first" is the order a
    // person scanning this list actually wants, and undated tasks sort
    // last rather than jumping the queue as NULLs otherwise would.
    orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  });
}

/// The open promises a person could be working on right now, for the
/// timer.
///
/// Team adoption, mechanism one: a stopped timer is the moment a person
/// already knows what happened, so it is the moment to ask - but only if
/// the timer knows which promise it was against. The field existed on
/// TimeEntry from the start and the timer screen never wrote it, so the
/// strongest update point in the product had nothing to update.
///
/// Client-visible tasks only. An internal task has no stage a client
/// reads and no question worth interrupting anyone for, and a picker
/// listing everything open would bury the few rows that matter.
export async function listOpenPromises(actor: User) {
  assertCan(actor.role, "time_entry.create_self");
  const accessible = await listAccessibleClients(actor);
  const ids = accessible.map((c) => c.id);
  if (ids.length === 0) return [];

  return prisma.task.findMany({
    where: {
      deletedAt: null,
      clientId: { in: ids },
      clientVisible: true,
      status: { in: OPEN_STATUSES },
    },
    // Soonest deadline first, undated last: the same order the Tasks
    // screen uses, so a person sees the list they already know.
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    // A cap rather than pagination: this feeds a picker inside a toast.
    // A person with more than this many open promises on their clients
    // has a problem no dropdown solves.
    take: 100,
    select: { id: true, clientId: true, title: true, clientTitle: true, status: true, clientOutcome: true },
  });
}

/// How long a visible promise may sit without a word before the home
/// screen says so. The spec's own number.
export const STALE_PROMISE_HOURS = 24;

/// The work one person is holding, for their own home screen.
///
/// Team adoption, mechanism two. The home screen shows timers, hours and
/// alerts, and has never shown tasks - so the answer to "what is on me
/// today" lived on a screen nobody opens first. Assigned to this person,
/// still open, soonest deadline first.
///
/// `stale` is the mark the spec asks for: a promise the client can see
/// that has not moved in a day. Computed here rather than in the screen
/// so the threshold is one number in one place.
export async function listMyOpenTasks(actor: User, take = 8) {
  assertCan(actor.role, "time_entry.create_self");
  const cutoff = new Date(Date.now() - STALE_PROMISE_HOURS * 3600_000);

  // Scoped to the clients this person can still reach, like every other
  // query in this module. An assignment is checked when it is made
  // (assertAssignable), but access can be taken away afterwards - and a
  // row on a client somebody no longer works on is a task they cannot
  // open, sitting at the top of their home screen telling them to.
  const accessible = await listAccessibleClients(actor);
  const ids = accessible.map((c) => c.id);
  if (ids.length === 0) return [];

  const rows = await prisma.task.findMany({
    where: {
      deletedAt: null,
      clientId: { in: ids },
      assignedToId: actor.id,
      status: { in: OPEN_STATUSES },
    },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "asc" }],
    take,
    select: {
      id: true,
      title: true,
      clientTitle: true,
      clientVisible: true,
      dueDate: true,
      updatedAt: true,
      client: { select: { name: true } },
    },
  });

  return rows.map((t) => ({
    id: t.id,
    title: t.clientTitle?.trim() || t.title,
    clientName: t.client.name,
    dueDate: t.dueDate,
    clientVisible: t.clientVisible,
    stale: t.clientVisible && t.updatedAt < cutoff,
  }));
}

/// Promises the client can see that have not moved today, by client.
///
/// Team adoption, mechanism four, and the reason it is a manager's
/// number rather than an employee's reminder: a person nudged about
/// their own row learns to dismiss the nudge, and a team measured on a
/// number talks about the number. The spec is explicit that this is
/// measured at the team level.
///
/// "Today" is the local day boundary, not a rolling window: a manager
/// reading this at four in the afternoon is asking what has been
/// untouched since the morning, and a rolling twenty-four hours would
/// answer a different question every hour.
export async function stalledPromisesByClient(actor: User, since: Date) {
  const accessible = await listAccessibleClients(actor);
  const ids = accessible.map((c) => c.id);
  if (ids.length === 0) return [];

  const rows = await prisma.task.findMany({
    where: {
      deletedAt: null,
      clientId: { in: ids },
      clientVisible: true,
      status: { in: OPEN_STATUSES },
      updatedAt: { lt: since },
    },
    select: { clientId: true, client: { select: { name: true } } },
  });

  const byClient = new Map<string, { clientId: string; clientName: string; count: number }>();
  for (const r of rows) {
    const found = byClient.get(r.clientId);
    if (found) found.count += 1;
    else byClient.set(r.clientId, { clientId: r.clientId, clientName: r.client.name, count: 1 });
  }
  return [...byClient.values()].sort((a, b) => b.count - a.count);
}

/// Who may be given a task on this client.
///
/// Deliberately NOT gated on `time_entry.edit_others` the way
/// lib/mcp/lookup.ts's team roster is. That permission answers "may this
/// person see a colleague's hours", which is a far larger disclosure than
/// "who else works on this client" - something every employee on the
/// account already knows from the client itself. The narrower question
/// gets the narrower gate: anyone who may log time may assign work, and
/// what they learn is limited to the colleagues who share their clients.
///
/// Returns only id/name/email - never role, never status, never the
/// whole row.
export async function assignableUsers(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      // A client-portal user is not staff and can never hold work.
      role: { not: "CLIENT_USER" },
      OR: [
        // Admins and managers reach every active client, so they never
        // hold UserClientAccess rows and must be included by role.
        { role: { in: MANAGING_ROLES } },
        { clientAccess: { some: { clientId } } },
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
  return users;
}

/// Throws unless `assignedToId` names someone who could actually see a
/// task on this client. See the Phase 16 note at the top of the file.
async function assertAssignable(actor: User, clientId: string, assignedToId: string) {
  const candidates = await assignableUsers(actor, clientId);
  if (!candidates.some((u) => u.id === assignedToId)) {
    throw new ForbiddenError(
      "That person does not have access to this client, so they would never see the task. Give them access to the client first, or assign it to someone who has it."
    );
  }
}

/// Mirrors the CLIENT-visibility half of assertActiveTargets() in
/// lib/app-domain/time-entries.ts. Not shared with it on purpose: that
/// function also enforces client/category ACTIVE-ness for billing
/// reasons and takes a mandatory category, neither of which fits a task.
/// The one rule that must not diverge is this one, so it is stated
/// explicitly here rather than implied.
async function assertCategoryUsable(actor: User, clientId: string, categoryId: string) {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new Error("Category not found.");
  if (category.visibility === "CLIENT" && category.clientId !== clientId) {
    throw new Error("This category does not belong to the selected client.");
  }
  if (!category.active && !can(actor.role, "category.manage")) {
    throw new Error("This category is inactive.");
  }
}

export async function createTask(
  actor: User,
  input: {
    clientId: string;
    categoryId?: string | null;
    title: string;
    assignedToId?: string | null;
    dueDate?: Date | null;
    /// Portal phase 1. Opt-in per task: see schema.prisma's comment on
    /// Task.clientVisible for why not every task is a promise.
    clientVisible?: boolean;
    clientTitle?: string | null;
  }
) {
  // permissions.ts requires every server-side entry point to assert, and
  // the Tasks screen was already gated on exactly this. Stating it here
  // means a second caller (the MCP server) cannot arrive without it.
  assertCan(actor.role, "time_entry.create_self");

  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === input.clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }
  const title = input.title.trim();
  if (!title) throw new Error("Task title is required.");

  if (input.categoryId) await assertCategoryUsable(actor, input.clientId, input.categoryId);
  if (input.assignedToId) await assertAssignable(actor, input.clientId, input.assignedToId);

  const task = await prisma.task.create({
    data: {
      clientId: input.clientId,
      categoryId: input.categoryId || null,
      title,
      assignedToId: input.assignedToId || null,
      dueDate: input.dueDate ?? null,
      clientVisible: input.clientVisible ?? false,
      clientTitle: input.clientTitle?.trim() || null,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "task.create",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: task,
  });
  return task;
}

export type TaskPatch = {
  title?: string;
  status?: TaskStatus;
  categoryId?: string | null;
  assignedToId?: string | null;
  dueDate?: Date | null;
  // Portal phase 1.
  clientVisible?: boolean;
  clientTitle?: string | null;
  waitingOnClientSince?: Date | null;
  // Portal phase 3: who did the work, and how they were. Recorded on the
  // task rather than in a supplier directory - see the schema comment on
  // Task.supplierName for why that is a decision and not a shortcut.
  supplierName?: string | null;
  supplierExperience?: SupplierExperience | null;
  // Team adoption: what came of it, in the client's language. A
  // client-visible task cannot be closed without this - see
  // assertClosable below.
  clientOutcome?: string | null;
};

/// The general task mutation. Every field is optional and only the keys
/// actually present are written, so a caller that means "just change the
/// due date" cannot accidentally blank the assignee by omitting it -
/// which is why this takes a patch rather than a whole task.
///
/// The definition of done, and the one rule in this module that refuses a
/// write rather than recording it.
///
/// A promise the client can see does not close without a sentence saying
/// what came of it. Not a nudge, not a badge on a list somebody reviews
/// later: the close itself does not happen. Everything downstream depends
/// on it - the activity screen, the monthly summary, and the client's own
/// answer to "what did I get this month" - and every one of those was
/// assembling itself out of task titles, which say what the thing was
/// called and never what happened to it.
///
/// Evaluated on the RESULTING state, not on the patch. Closing a visible
/// task and making a closed task visible arrive here as different patches
/// and produce the same thing: a promise on a client's screen marked done
/// with nothing to show for it.
///
/// The message is what the person sees, so it says what to do.
export const NO_OUTCOME_MESSAGE =
  "משימה שהלקוח רואה לא נסגרת בלי שורת תוצאה. כתבו במשפט אחד, בשפה של הלקוח, מה קרה בפועל.";

function assertClosable(
  current: { status: TaskStatus; clientVisible: boolean; clientOutcome: string | null },
  data: TaskPatch
) {
  const status = data.status ?? current.status;
  const visible = data.clientVisible ?? current.clientVisible;
  const outcome = data.clientOutcome !== undefined ? data.clientOutcome : current.clientOutcome;
  if (status === "DONE" && visible && !outcome?.trim()) throw new Error(NO_OUTCOME_MESSAGE);
}

/// `null` is meaningful and distinct from absent: it clears the field.
export async function updateTask(actor: User, taskId: string, patch: TaskPatch) {
  assertCan(actor.role, "time_entry.create_self");

  const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null } });
  if (!task) throw new Error("Task not found.");

  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === task.clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }

  // Not TaskPatch: this carries two fields the patch contract deliberately
  // does not expose (supplierRecordedAt and completedAt, which the server
  // owns).
  const data: TaskPatch & { supplierRecordedAt?: Date | null; completedAt?: Date | null } = {};
  const withCompletion = data;

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("Task title cannot be empty.");
    data.title = title;
  }
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.categoryId !== undefined) {
    if (patch.categoryId) await assertCategoryUsable(actor, task.clientId, patch.categoryId);
    data.categoryId = patch.categoryId || null;
  }
  if (patch.assignedToId !== undefined) {
    if (patch.assignedToId) await assertAssignable(actor, task.clientId, patch.assignedToId);
    data.assignedToId = patch.assignedToId || null;
  }
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate;
  if (patch.clientVisible !== undefined) data.clientVisible = patch.clientVisible;
  if (patch.clientTitle !== undefined) data.clientTitle = patch.clientTitle?.trim() || null;
  if (patch.waitingOnClientSince !== undefined) data.waitingOnClientSince = patch.waitingOnClientSince;

  // The supplier line, and the timestamp that goes with it.
  //
  // `supplierRecordedAt` is set here rather than accepted from the caller
  // because it is the client's "when" on their own file, and a date the
  // caller can choose is a date that will eventually be wrong. Clearing
  // the name clears the timestamp with it, so a half-erased row cannot
  // survive as a date with nobody attached to it.
  if (patch.supplierName !== undefined) {
    const name = patch.supplierName?.trim() || null;
    data.supplierName = name;
    data.supplierRecordedAt = name ? (task.supplierRecordedAt ?? new Date()) : null;
    if (!name) data.supplierExperience = null;
  }
  if (patch.supplierExperience !== undefined) {
    data.supplierExperience = patch.supplierExperience ?? null;
  }
  if (patch.clientOutcome !== undefined) data.clientOutcome = patch.clientOutcome?.trim() || null;

  if (Object.keys(data).length === 0) return task;

  assertClosable(task, data);

  // `completedAt` is the server's, not the caller's.
  //
  // Set on the way into DONE and cleared on the way back out to open
  // work, so a task that is reopened stops claiming a completion date it
  // no longer has. ARCHIVED keeps whatever it had: archiving finished
  // work does not unfinish it.
  const nextStatus = data.status ?? task.status;
  if (nextStatus === "DONE" && task.status !== "DONE") {
    withCompletion.completedAt = new Date();
  } else if (nextStatus !== "DONE" && nextStatus !== "ARCHIVED" && task.completedAt) {
    withCompletion.completedAt = null;
  }

  const updated = await prisma.task.update({ where: { id: taskId }, data });
  await recordAudit({
    actorId: actor.id,
    // Kept as the existing action name when status is the only change, so
    // the audit log stays queryable the way it already was.
    action: Object.keys(data).length === 1 && data.status !== undefined ? "task.status_change" : "task.update",
    entityType: "Task",
    entityId: taskId,
    clientId: task.clientId,
    before: task,
    after: updated,
  });
  return updated;
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "פתוחה",
  IN_PROGRESS: "בביצוע",
  DONE: "הושלמה",
  ARCHIVED: "בארכיון",
};
