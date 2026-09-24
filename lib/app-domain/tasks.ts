import "server-only";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, assertCan, can, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import type { SupplierExperience, User, TaskPriority, TaskStatus, UserRole } from "@prisma/client";

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

/// The statuses that mean "not finished". Used for the default MCP task
/// list and for `onlyOpen` - DONE and ARCHIVED are history, and a model
/// asked "what is open" should not have to know the enum.
///
/// PENDING_APPROVAL is open work. The person who did it is finished with
/// it; the task is not, because nobody has signed it off yet. Leaving it
/// out would have made a task disappear from its owner's own list the
/// moment they sent it for approval, which is the exact moment they most
/// need to be able to find it again.
///
/// This constant is the single definition of that set. Anything asking
/// "which tasks are still live" reads it rather than writing the list
/// out, so a status added to the enum is a change in one place.
export const OPEN_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"];

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
  /// Tasks phase 1: only work at this priority or above. A single floor
  /// rather than a set, because the question a person asks of a list is
  /// "show me what matters", never "show me exactly the high ones".
  minPriority?: TaskPriority;
  /// Tasks phase 2: only tasks this person is the supervisor of. Pass
  /// the actor's own id for the supervision screen.
  supervisorId?: string;
};

/// Most urgent first. Postgres orders an enum by its declaration order,
/// which runs LOW to URGENT, so the column sorts descending and the floor
/// in `minPriority` is expressed as "in these values" rather than a
/// comparison - an enum has no > operator Prisma will write for us.
const PRIORITY_ORDER: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

function priorityAtLeast(floor: TaskPriority): TaskPriority[] {
  return PRIORITY_ORDER.slice(PRIORITY_ORDER.indexOf(floor));
}

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
      priority: filters.minPriority ? { in: priorityAtLeast(filters.minPriority) } : undefined,
      supervisorId: filters.supervisorId || undefined,
    },
    include: { client: true, category: true, assignedTo: true, supervisor: true },
    // Open/In-progress first (spec §11: "open/recent tasks"), then by
    // deadline, then newest first. The dueDate leg is Phase 16: with due
    // dates finally readable, "soonest deadline first" is the order a
    // person scanning this list actually wants, and undated tasks sort
    // last rather than jumping the queue as NULLs otherwise would.
    // Open/In-progress first, then most urgent, then by deadline, then
    // newest. Priority sits ABOVE the deadline on purpose: a due date
    // says when someone wrote a date down, and a priority says what a
    // person decided. When the two disagree, the decision wins.
    orderBy: [
      { status: "asc" },
      { priority: "desc" },
      { dueDate: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
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
/// Tasks phase 2: how much is on this person as a supervisor, and how
/// much of it is waiting on them right now.
///
/// Two numbers from one query, because both are read on every page: the
/// nav shows the supervision screen only to people who actually
/// supervise something, and shows a count beside it only when something
/// is waiting. A person who supervises nothing pays for one grouped
/// count and sees no extra nav row at all.
///
/// Scoped to the clients this person can still reach, like every other
/// query in this module and for the same reason as listMyOpenTasks: a
/// supervisor can lose access to a client after being named on its
/// tasks, and a count that includes rows they cannot open is a badge
/// that never goes away.
export async function supervisionCounts(actor: User): Promise<{ total: number; pending: number }> {
  if (!can(actor.role, "time_entry.create_self")) return { total: 0, pending: 0 };

  const accessible = await listAccessibleClients(actor);
  const ids = accessible.map((c) => c.id);
  if (ids.length === 0) return { total: 0, pending: 0 };

  const rows = await prisma.task.groupBy({
    by: ["status"],
    where: {
      deletedAt: null,
      clientId: { in: ids },
      supervisorId: actor.id,
      // Finished work is not supervision any more. Counting it would
      // make the nav row permanent for anybody who ever supervised
      // anything once.
      status: { in: OPEN_STATUSES },
    },
    _count: { _all: true },
  });

  let total = 0;
  let pending = 0;
  for (const row of rows) {
    total += row._count._all;
    if (row.status === "PENDING_APPROVAL") pending += row._count._all;
  }
  return { total, pending };
}

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

/// The same rule for the supervisor, and for a stronger reason.
///
/// An assignee without access to the client would never find the task.
/// A supervisor without access could not open the thing they are being
/// asked to sign for, which makes the approval either a rubber stamp or
/// a dead end. Both are worse than refusing here.
async function assertSupervisable(actor: User, clientId: string, supervisorId: string) {
  const candidates = await assignableUsers(actor, clientId);
  if (!candidates.some((u) => u.id === supervisorId)) {
    throw new ForbiddenError(
      "That person does not have access to this client, so they could not open the task they are being asked to approve. Give them access to the client first, or choose a supervisor who has it."
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
    /// Tasks phase 1. Markdown as plain text; nothing renders it as HTML
    /// on the way in.
    description?: string | null;
    priority?: TaskPriority;
    assignedToId?: string | null;
    /// Tasks phase 2. A task can be born supervised - the important-dates
    /// job and the MCP server both create tasks nobody is standing over,
    /// and the one place a supervisor is genuinely known at creation time
    /// is a person opening the drawer and choosing one.
    supervisorId?: string | null;
    requiresApproval?: boolean;
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
  if (input.supervisorId) await assertSupervisable(actor, input.clientId, input.supervisorId);
  // The same refusal updateTask makes, at the other end. A task created
  // needing an approval nobody can give is a task born unclosable.
  if (input.requiresApproval && !input.supervisorId) throw new Error(APPROVAL_WITHOUT_SUPERVISOR_MESSAGE);

  const task = await prisma.task.create({
    data: {
      clientId: input.clientId,
      categoryId: input.categoryId || null,
      title,
      description: input.description?.trim() || null,
      priority: input.priority ?? "NORMAL",
      assignedToId: input.assignedToId || null,
      supervisorId: input.supervisorId || null,
      requiresApproval: input.requiresApproval ?? false,
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

/// The one TaskPatch key the audit action is named after. A named
/// constant so the comparison below carries no string literal of its own
/// - see the note at the recordAudit call in updateTask.
const STATUS_KEY = "status";

export type TaskPatch = {
  title?: string;
  // Tasks phase 1.
  description?: string | null;
  priority?: TaskPriority;
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
  // Tasks phase 2. `approvedById` and `approvedAt` are deliberately NOT
  // here: they are the server's record of who signed, written on the
  // transition and never accepted from a caller, exactly like
  // `completedAt`. A signature a caller can supply is not a signature.
  supervisorId?: string | null;
  requiresApproval?: boolean;
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
/// Evaluated on the RESULTING state, but only for a patch that MOVES
/// something into it. Closing a visible task and making a closed task
/// visible arrive here as different patches and produce the same thing:
/// a promise on a client's screen marked done with nothing to show for
/// it. Both are refused.
///
/// A patch that touches none of the three is left alone even when the row
/// is already in that state, and that is not a loophole - it is the
/// difference between a rule and a trap. Every promise closed before this
/// existed is a row with no outcome on it, and a rule evaluated on state
/// alone would mean nobody can ever correct a supplier, a title or a
/// category on any of them again. Found by a test written for the
/// supplier line, which is exactly the sort of edit that would have
/// started failing in production for no reason a person could see.
///
/// The message is what the person sees, so it says what to do.
export const NO_OUTCOME_MESSAGE =
  "משימה שהלקוח רואה לא נסגרת בלי שורת תוצאה. כתבו במשפט אחד, בשפה של הלקוח, מה קרה בפועל.";

function assertClosable(
  current: { status: TaskStatus; clientVisible: boolean; clientOutcome: string | null },
  data: TaskPatch
) {
  const touches =
    data.status !== undefined || data.clientVisible !== undefined || data.clientOutcome !== undefined;
  if (!touches) return;

  const status = data.status ?? current.status;
  const visible = data.clientVisible ?? current.clientVisible;
  const outcome = data.clientOutcome !== undefined ? data.clientOutcome : current.clientOutcome;
  // PENDING_APPROVAL counts, and phase 2 added it here rather than
  // leaving the rule on DONE alone. Sending a promise for approval is a
  // person saying they are finished with it, and the supervisor is about
  // to be asked whether it can close. Without the sentence, the
  // supervisor is asked to sign for something with nothing to show, and
  // then blocked by this very rule at the moment they try - the refusal
  // would land on the one person who could not have prevented it.
  const claimsFinished = status === "DONE" || status === "PENDING_APPROVAL";
  if (claimsFinished && visible && !outcome?.trim()) throw new Error(NO_OUTCOME_MESSAGE);
}

/// Tasks phase 2. Three refusals, and every one of them is stated on the
/// CHANGE rather than on the resulting state.
///
/// That distinction is not stylistic, and the team-adoption phase paid
/// for it once already. A rule written as "a task in this shape may not
/// exist" silently applies to every row that already exists, so the day
/// it ships, edits that have nothing to do with it start failing on old
/// data for reasons nobody can see. A rule written as "this move is not
/// allowed" applies only to people making that move, from today. The
/// `touches` guard below is what makes it the second kind: a patch that
/// says nothing about status, supervision or the flag is never refused
/// here, however the row looks.
export const APPROVAL_WITHOUT_SUPERVISOR_MESSAGE =
  "כדי לדרוש אישור צריך לבחור מפקח. בלי מפקח אין מי שיאשר, והמשימה לא תיסגר לעולם.";
export const NEEDS_APPROVAL_MESSAGE =
  "המשימה הזו דורשת אישור. שלחו אותה לאישור, והמפקח יסגור אותה.";
export const NOT_THE_SUPERVISOR_MESSAGE =
  "רק המפקח של המשימה יכול לאשר אותה או לוותר על האישור.";

/// Exported, and narrowed to the two fields of the actor it actually
/// reads, so it can be called directly from a test.
///
/// Deliberate. This is the highest-stakes logic phase 2 adds and it is a
/// pure function of three arguments, so the whole transition matrix can
/// be checked in milliseconds. The alternative was to reach it only
/// through `updateTask`, which needs a database, which means CI, which
/// means one answer every twelve minutes. The repo learned that lesson
/// twice over on the refresh-after-write investigation.
export function assertApprovable(
  actor: { id: string; role: UserRole },
  current: { status: TaskStatus; supervisorId: string | null; requiresApproval: boolean },
  data: TaskPatch
) {
  const touches =
    data.status !== undefined || data.requiresApproval !== undefined || data.supervisorId !== undefined;
  if (!touches) return;

  const nextStatus = data.status ?? current.status;
  const nextRequires = data.requiresApproval ?? current.requiresApproval;
  const nextSupervisor = data.supervisorId !== undefined ? data.supervisorId : current.supervisorId;

  /// Whoever the task defers to, plus the people who can already edit
  /// anyone's work. The second half is not a loophole: without it, a
  /// supervisor on holiday is a task nobody in the company can close,
  /// and the answer to that would be people turning the flag off, which
  /// leaves no record at all. An admin closing it leaves one.
  const maySign = actor.id === nextSupervisor || can(actor.role, "time_entry.edit_others");

  // 1. Demanding a signature from nobody. This is the trap the whole
  //    feature could have shipped with: approval required, supervisor
  //    empty, and a task that can never reach DONE by any route on any
  //    screen. Refused at the moment it is created rather than
  //    discovered later by whoever tried to close it.
  if (nextRequires && !nextSupervisor) throw new Error(APPROVAL_WITHOUT_SUPERVISOR_MESSAGE);

  // 2. The gate itself. A task that needs approval reaches DONE through
  //    PENDING_APPROVAL and no other way.
  if (nextRequires && nextStatus === "DONE" && current.status !== "PENDING_APPROVAL") {
    throw new Error(NEEDS_APPROVAL_MESSAGE);
  }

  // 3. Who may sign, and who may waive. Both are the same decision seen
  //    from two sides: closing work that is waiting for a signature, and
  //    removing the requirement while it waits. A gate that the person
  //    being gated can switch off is not a gate, so the waiver is the
  //    supervisor's too - but only from PENDING_APPROVAL. Up to that
  //    moment the flag is an ordinary setting anyone on the client can
  //    change, because nothing is riding on it yet.
  if (current.status === "PENDING_APPROVAL" && current.requiresApproval && !maySign) {
    const closing = nextStatus === "DONE";
    const waiving = data.requiresApproval === false;
    if (closing || waiving) throw new ForbiddenError(NOT_THE_SUPERVISOR_MESSAGE);
  }
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

  // Not TaskPatch: this carries three fields the patch contract
  // deliberately does not expose (supplierRecordedAt, completedAt and
  // startedAt, all of which the server owns).
  const data: TaskPatch & {
    supplierRecordedAt?: Date | null;
    completedAt?: Date | null;
    startedAt?: Date | null;
    approvedById?: string | null;
    approvedAt?: Date | null;
  } = {};
  const withCompletion = data;

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("Task title cannot be empty.");
    data.title = title;
  }
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.categoryId !== undefined) {
    if (patch.categoryId) await assertCategoryUsable(actor, task.clientId, patch.categoryId);
    data.categoryId = patch.categoryId || null;
  }
  if (patch.assignedToId !== undefined) {
    if (patch.assignedToId) await assertAssignable(actor, task.clientId, patch.assignedToId);
    data.assignedToId = patch.assignedToId || null;
  }
  if (patch.supervisorId !== undefined) {
    if (patch.supervisorId) await assertSupervisable(actor, task.clientId, patch.supervisorId);
    data.supervisorId = patch.supervisorId || null;
  }
  if (patch.requiresApproval !== undefined) data.requiresApproval = patch.requiresApproval;
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

  // What the CALLER asked to change, captured before the server adds its
  // own columns below. The audit action is named off this rather than off
  // the final `data`, because `completedAt` and `startedAt` are written
  // by this function and would otherwise turn every plain status change
  // into a "task.update" - which is exactly the query the audit log was
  // promised to keep answering, and which the history panel on the task
  // screen now reads.
  const callerChanged = Object.keys(data);

  assertClosable(task, data);
  assertApprovable(actor, task, data);

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

  // `startedAt`, the other end of cycle time, and the server's too.
  //
  // Written the FIRST time a task leaves OPEN and never moved again,
  // which is the difference between "when did work begin" and "when was
  // this last touched". A task that goes to DONE and is reopened to
  // IN_PROGRESS keeps its original start, because the work did begin
  // then and a second start date would quietly shorten every cycle-time
  // number that reads it.
  //
  // Cleared only on the way back to OPEN, which is the one transition
  // where a person is saying the work has not in fact started.
  if (nextStatus === "OPEN") {
    if (task.startedAt) withCompletion.startedAt = null;
  } else if (!task.startedAt) {
    withCompletion.startedAt = new Date();
  }

  // The signature, and the server's like the two above it.
  //
  // Written on the one transition that is an approval: out of
  // PENDING_APPROVAL and into DONE. Cleared on the way back to open work
  // for the same reason `completedAt` is, and it matters more here - an
  // approval that survived a reopen would be a person's name on work
  // that changed after they signed for it.
  //
  // ARCHIVED keeps it, exactly as it keeps `completedAt`: filing
  // finished work away does not unsign it.
  if (nextStatus === "DONE" && task.status === "PENDING_APPROVAL") {
    withCompletion.approvedById = actor.id;
    withCompletion.approvedAt = new Date();
  } else if (nextStatus !== "DONE" && nextStatus !== "ARCHIVED" && task.approvedAt) {
    withCompletion.approvedById = null;
    withCompletion.approvedAt = null;
  }

  const updated = await prisma.task.update({ where: { id: taskId }, data });

  // Kept as the existing action name when status is the only change, so
  // the audit log stays queryable the way it already was.
  //
  // Computed here rather than inline in the call below, and not only for
  // readability: tests/unit/audit-labels.test.ts reads this file as text
  // to check every audited action has a Hebrew label, and a quoted string
  // inside the `action:` expression reads to that scanner as another
  // action name. A ternary comparing against "status" made it report a
  // phantom action called `status`. Nothing here is worth making that
  // check less strict.
  const statusOnly = callerChanged.length === 1 && callerChanged[0] === STATUS_KEY;
  /// An approval is a status change, and naming it one would bury it.
  /// "מי אישר את זה" is a question somebody asks about a specific task
  /// months later, and it should be answerable by reading the log rather
  /// than by inferring it from a pair of timestamps.
  ///
  /// The literals stay inside the `action:` expression below rather than
  /// being lifted into a variable: tests/unit/audit-labels.test.ts reads
  /// this file as text and collects the quoted strings it finds there, so
  /// an action hidden behind an identifier is an action that silently
  /// stops being checked for a Hebrew label.
  const approving = updated.approvedAt !== null && task.approvedAt === null;

  await recordAudit({
    actorId: actor.id,
    action: approving ? "task.approve" : statusOnly ? "task.status_change" : "task.update",
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
  PENDING_APPROVAL: "ממתינה לאישור",
  DONE: "הושלמה",
  ARCHIVED: "בארכיון",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "נמוכה",
  NORMAL: "רגילה",
  HIGH: "גבוהה",
  URGENT: "דחופה",
};

// ---------------------------------------------------------------------
// Tasks phase 1: the task screen.
//
// Until now a task existed only as a row in a list. A row is a fine place
// to tick a checkbox and a bad place to do anything else - read what the
// work actually is, see how long it has taken, or find out who changed
// what. Everything below feeds one screen, /app/tasks/[id].
//
// Three of these reads already existed as data nobody could see:
// AuditEvent has recorded every task mutation since phase 1, TimeEntry
// has pointed at a task since phase 2, and neither was ever displayed.
// ---------------------------------------------------------------------

/// The Hebrew for what the audit log records about a task.
///
/// A map rather than a switch so an action this module does not know
/// about falls through to a generic line instead of crashing the screen:
/// AuditEvent.action is a plain String by design, and a future phase will
/// add verbs this build has never heard of.
const TASK_AUDIT_LABELS: Record<string, string> = {
  "task.create": "המשימה נפתחה",
  "task.update": "המשימה עודכנה",
  "task.status_change": "הסטטוס שונה",
  "task.approve": "המשימה אושרה",
};

/// One line of a task's history, already in the words a person reads.
export type TaskHistoryEntry = {
  id: string;
  at: Date;
  actorName: string | null;
  label: string;
  /// The fields that actually changed, in Hebrew, for the lines where
  /// knowing "what" is the whole point. Empty on creation.
  changed: string[];
};

/// Field names as a person would say them. Only the fields worth naming
/// in a history line appear here; anything else is summarised as a count
/// rather than exposed by its column name.
const FIELD_LABELS: Record<string, string> = {
  title: "כותרת",
  description: "תיאור",
  priority: "עדיפות",
  status: "סטטוס",
  categoryId: "קטגוריה",
  assignedToId: "אחראי",
  supervisorId: "מפקח",
  requiresApproval: "דורשת אישור",
  dueDate: "תאריך יעד",
  clientVisible: "הצגה ללקוח",
  clientTitle: "כותרת ללקוח",
  waitingOnClientSince: "ממתין ללקוח",
  clientOutcome: "משפט התוצאה",
  supplierName: "ספק",
  supplierExperience: "חוויה מהספק",
};

/// Server-owned columns. They move on their own as a consequence of
/// somebody else's change, so listing them in a history line would tell a
/// person about bookkeeping rather than about a decision.
const DERIVED_FIELDS = new Set([
  "updatedAt",
  "startedAt",
  "completedAt",
  "supplierRecordedAt",
  // Tasks phase 2. Who signed and when is a line of its own in the
  // history ("המשימה אושרה"), so naming the columns again beside it
  // would say the same thing twice in the same entry.
  "approvedById",
  "approvedAt",
]);

function changedFields(before: unknown, after: unknown): string[] {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const names: string[] = [];
  for (const key of Object.keys(a)) {
    if (DERIVED_FIELDS.has(key)) continue;
    // JSON round-trips dates to strings on one side and not the other, so
    // compare the serialised form rather than the values.
    if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
    const label = FIELD_LABELS[key];
    if (label) names.push(label);
  }
  return names;
}

/// Everything one task screen shows, in one call.
///
/// Returns null rather than throwing when the task does not exist or the
/// actor cannot reach its client: a page renders a not-found for both,
/// and telling the two apart would confirm that a task exists on a client
/// somebody has no access to.
export async function getTaskDetail(actor: User, taskId: string) {
  assertCan(actor.role, "time_entry.create_self");

  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    include: {
      client: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      // Tasks phase 2. Two names the screen shows and never writes: who
      // this goes back to, and who signed it off.
      supervisor: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
  });
  if (!task) return null;

  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === task.clientId)) return null;

  const [entries, audit] = await Promise.all([
    // Every reported minute on this task, by whom. Running timers
    // (endAt null, so actualSeconds null) are counted separately rather
    // than as zero - a task with a timer running on it right now is not
    // a task with no time on it.
    prisma.timeEntry.findMany({
      where: { taskId: task.id, deletedAt: null },
      orderBy: { startAt: "desc" },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        actualSeconds: true,
        note: true,
        user: { select: { id: true, name: true } },
      },
    }),
    prisma.auditEvent.findMany({
      where: { entityType: "Task", entityId: task.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        action: true,
        createdAt: true,
        beforeJson: true,
        afterJson: true,
        actor: { select: { name: true } },
      },
    }),
  ]);

  const byUser = new Map<string, { userId: string; userName: string; seconds: number }>();
  let totalSeconds = 0;
  for (const e of entries) {
    const seconds = e.actualSeconds ?? 0;
    totalSeconds += seconds;
    const found = byUser.get(e.user.id);
    if (found) found.seconds += seconds;
    else byUser.set(e.user.id, { userId: e.user.id, userName: e.user.name, seconds });
  }

  const history: TaskHistoryEntry[] = audit.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actorName: row.actor?.name ?? null,
    label: TASK_AUDIT_LABELS[row.action] ?? "שינוי במשימה",
    changed: row.action === "task.create" ? [] : changedFields(row.beforeJson, row.afterJson),
  }));

  return {
    task,
    time: {
      totalSeconds,
      byUser: [...byUser.values()].sort((a, b) => b.seconds - a.seconds),
      runningCount: entries.filter((e) => e.endAt === null).length,
      entryCount: entries.length,
    },
    history,
  };
}
