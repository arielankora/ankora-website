import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, can, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { computeEntryBillableSeconds } from "@/lib/app-domain/billing";
import { flagAffectedCyclesRecalculated } from "@/lib/app-domain/hour-banks";
import { evaluateAlertsForClient } from "@/lib/app-domain/alerts";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";
import type { User, TimeEntry, Prisma } from "@prisma/client";

// Phase 2 domain service: spec 23 "Timer + TimeEntry + manual entry + audit
// revisions." Everything here backs spec 18.1's timer/start, timer/stop and
// PATCH time-entry operations, and spec 6/6.1-6.4's business rules. As with
// every other domain-service file, every exported function starts with an
// assertCan() check - never trust the caller's UI to have hidden a button
// (spec 4.1).

/// Spec 6.4: "לעובד רגיל ניתן להגדיר חלון עריכה, למשל עד סוף היום/48
/// שעות. לאחר מכן נדרשת הרשאת Manager." 48 hours chosen as the concrete
/// default the spec itself offers as an example; kept as one named
/// constant so a future admin-configurable version has a single place to
/// replace with a DB-backed setting.
const SELF_EDIT_WINDOW_HOURS = 48;

/// Spec 6.3: "חובה סיבת דיווח ידני אם המשתמש מוסיף Entry ליום קודם מעבר
/// ל-window configurable." Interpreted as: any manual entry whose date
/// (Asia/Jerusalem) differs from today's requires a non-empty reason.
/// `localDateKey` (Phase 8: lib/timezone.ts) is the shared Asia/Jerusalem
/// day-boundary helper - this file had its own private copy of it before
/// Phase 8 extracted the shared version.

export class OverlapError extends Error {
  constructor(public readonly conflicting: TimeEntry) {
    super("This time range overlaps an existing entry.");
    this.name = "OverlapError";
  }
}

export class ActiveTimerExistsError extends Error {
  constructor() {
    super("You already have an active timer running.");
    this.name = "ActiveTimerExistsError";
  }
}

export class EditWindowExpiredError extends Error {
  constructor() {
    super("The self-edit window for this entry has expired; a manager must make this change.");
    this.name = "EditWindowExpiredError";
  }
}

export class BackdateReasonRequiredError extends Error {
  constructor() {
    super("A reason is required when reporting time for a previous day.");
    this.name = "BackdateReasonRequiredError";
  }
}

/// Phase 7 (spec 20: "Conflict = אם Entry השתנה במקביל, לא לדרוס. להציג
/// refresh/compare."). Thrown by updateTimeEntry when the caller supplied
/// an `expectedUpdatedAt` (captured when their edit form was opened/last
/// loaded) that no longer matches the row's current `updatedAt` - i.e.
/// someone else changed this entry after this editor loaded it. The
/// update is rejected before any write happens; the caller is expected to
/// refresh and re-apply their edit rather than silently overwriting.
export class ConflictError extends Error {
  constructor(public readonly current: TimeEntry) {
    super("This entry was changed by someone else since you opened it.");
    this.name = "ConflictError";
  }
}

function isBackdated(startAt: Date): boolean {
  return localDateKey(startAt) !== localDateKey(new Date());
}

/// Combines a `YYYY-MM-DD` date and `HH:mm` time - both entered by the
/// user as Asia/Jerusalem wall-clock time via <input type="date"/time"> -
/// into the correct UTC instant. Thin wrapper around the generalized
/// `localDateTimeToUtc` (Phase 8: lib/timezone.ts) fixed to this file's
/// Asia/Jerusalem TIMEZONE constant - see that function's own comment for
/// why naive `new Date(...)` parsing is wrong here.
export function combineWallClockTime(dateStr: string, timeStr: string): Date {
  return localDateTimeToUtc(dateStr, timeStr, TIMEZONE);
}

/// Spec 4.1: "אסור לעובד לדווח זמן ללקוח שאינו משויך אליו, אלא אם יש
/// הרשאת override." Admins/managers (client.manage) always pass; anyone
/// else needs an explicit UserClientAccess row.
export async function canAccessClientForTimeEntry(actor: User, clientId: string): Promise<boolean> {
  if (canManageClients(actor.role)) return true;
  const access = await prisma.userClientAccess.findUnique({
    where: { userId_clientId: { userId: actor.id, clientId } },
  });
  return !!access;
}

async function assertClientAccess(actor: User, clientId: string) {
  const allowed = await canAccessClientForTimeEntry(actor, clientId);
  if (!allowed) {
    throw new ForbiddenError("You are not assigned to this client.");
  }
}

/// Spec 5.1: "לא ניתן לשייך Entry לקטגוריה/לקוח inactive ללא override
/// אדמין." Admins (category.manage) may still target an inactive
/// category/client; everyone else is blocked.
async function assertActiveTargets(actor: User, clientId: string, categoryId: string) {
  const hasOverride = can(actor.role, "category.manage");
  const [client, category] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
    prisma.category.findUniqueOrThrow({ where: { id: categoryId } }),
  ]);
  if (!hasOverride && (client.status !== "ACTIVE" || !category.active)) {
    throw new Error("This client or category is inactive.");
  }
  if (category.visibility === "CLIENT" && category.clientId !== clientId) {
    throw new Error("This category does not belong to the selected client.");
  }
}

/// Spec 5.1: "TimeEntry חייב start_at < end_at." When endAt is null (an
/// active timer) there is nothing to compare yet.
function assertValidRange(startAt: Date, endAt: Date | null) {
  if (endAt && startAt.getTime() >= endAt.getTime()) {
    throw new Error("Start time must be before end time.");
  }
}

/// Spec 6.3: "Validation למניעת overlap: להתריע על חפיפה עם Entry קיים;
/// אפשר override רק למי שיש permission." Half-open interval overlap
/// check: [startAt, endAt) vs [existing.startAt, existing.endAt or now).
async function findOverlap(
  userId: string,
  startAt: Date,
  endAt: Date | null,
  excludeEntryId?: string
): Promise<TimeEntry | null> {
  const effectiveEnd = endAt ?? new Date("9999-01-01"); // an active timer blocks everything after it starts
  return prisma.timeEntry.findFirst({
    where: {
      userId,
      deletedAt: null,
      id: excludeEntryId ? { not: excludeEntryId } : undefined,
      startAt: { lt: effectiveEnd },
      OR: [{ endAt: null }, { endAt: { gt: startAt } }],
    },
  });
}

async function assertNoOverlap(
  actor: User,
  userId: string,
  startAt: Date,
  endAt: Date | null,
  allowOverride: boolean,
  excludeEntryId?: string
) {
  const conflict = await findOverlap(userId, startAt, endAt, excludeEntryId);
  if (!conflict) return;
  // Spec 6.3: "אפשר override רק למי שיש permission" - the actor performing
  // the write needs edit_others to push through a flagged overlap,
  // regardless of whose entry it is.
  const hasOverridePermission = can(actor.role, "time_entry.edit_others");
  if (allowOverride && hasOverridePermission) return;
  throw new OverlapError(conflict);
}

// ---------------------------------------------------------------------
// Timer (spec 6.1, 6.2, 18.1 timer/start + timer/stop)
// ---------------------------------------------------------------------

export async function getActiveTimer(userId: string): Promise<TimeEntry | null> {
  return prisma.timeEntry.findFirst({
    where: { userId, endAt: null, deletedAt: null },
    include: { client: true, category: true, task: true },
  });
}

export async function startTimer(
  actor: User,
  input: { clientId: string; categoryId: string; taskId?: string | null; note?: string | null }
) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  await assertActiveTargets(actor, input.clientId, input.categoryId);

  // Friendly pre-check (spec 5.1: "טיימר פעיל אחד לכל משתמש כברירת מחדל.
  // ניסיון להפעיל שני מציג החלטה: עצור קודם / בטל."). The database's
  // partial unique index (see prisma/schema.prisma's Phase 2 header) is
  // the actual race-safe guarantee for concurrent start requests (spec
  // 18.2) - this pre-check only produces a nicer error on the common,
  // non-racing path.
  const existingActive = await getActiveTimer(actor.id);
  if (existingActive) throw new ActiveTimerExistsError();

  let entry: TimeEntry;
  try {
    entry = await prisma.timeEntry.create({
      data: {
        userId: actor.id,
        clientId: input.clientId,
        categoryId: input.categoryId,
        taskId: input.taskId ?? null,
        startAt: new Date(),
        endAt: null,
        note: input.note?.trim() || null,
        source: "TIMER",
        isManual: false,
      },
    });
  } catch (err: any) {
    // Postgres 23505 = unique_violation. Catches the rare race the
    // pre-check above missed and turns it into the same friendly error.
    if (err?.code === "P2002" || err?.code === "23505") {
      throw new ActiveTimerExistsError();
    }
    throw err;
  }

  await recordAudit({
    actorId: actor.id,
    action: "time_entry.create",
    entityType: "TimeEntry",
    entityId: entry.id,
    clientId: entry.clientId,
    after: entry,
  });
  return entry;
}

export async function stopTimer(
  actor: User,
  timeEntryId: string,
  input?: { note?: string | null; categoryId?: string; taskId?: string | null }
) {
  const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
  const isSelf = entry.userId === actor.id;
  assertCan(actor.role, isSelf ? "time_entry.edit_self" : "time_entry.edit_others");

  if (!entry.endAt) {
    const endAt = new Date();
    const actualSeconds = Math.max(0, Math.round((endAt.getTime() - entry.startAt.getTime()) / 1000));
    // Phase 3: billable diverges from actual per the client's
    // BillingPolicy (spec 7); a client with no policy row gets the
    // identical Phase 2 behavior (billable === actual).
    const billableSeconds = await computeEntryBillableSeconds(entry.clientId, actualSeconds);

    // Idempotent stop (spec 18.2: "בקשת Stop חוזרת עם אותו idempotency
    // key לא יוצרת Entry כפול"). A conditional UPDATE ... WHERE endAt IS
    // NULL naturally no-ops a duplicate/double Stop click without needing
    // a separate idempotency-key table: the first request wins the row,
    // the second finds updatedCount === 0 and just re-reads the result.
    const { count } = await prisma.timeEntry.updateMany({
      where: { id: timeEntryId, endAt: null },
      data: {
        endAt,
        actualSeconds,
        billableSeconds,
        note: input?.note !== undefined ? input.note?.trim() || null : undefined,
        categoryId: input?.categoryId,
        taskId: input?.taskId,
      },
    });

    if (count > 0) {
      const updated = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
      await recordAudit({
        actorId: actor.id,
        action: "time_entry.update",
        entityType: "TimeEntry",
        entityId: entry.id,
        clientId: entry.clientId,
        before: entry,
        after: updated,
      });

      // Phase 4 (spec 9.2): stopping a timer changes the client's
      // consumed minutes, so it's a natural trigger point for
      // threshold evaluation. Best-effort/non-fatal - a failure here
      // must never undo the timer stop that already committed above.
      await evaluateAlertsForClient(updated.clientId).catch((err) =>
        console.error("evaluateAlertsForClient failed (non-fatal)", err)
      );

      return updated;
    }
  }

  // Already stopped (by this request or a concurrent duplicate) - return
  // the current state rather than erroring, per spec 18.2's idempotency
  // requirement.
  return prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
}

// ---------------------------------------------------------------------
// Manual entry (spec 6.3)
// ---------------------------------------------------------------------

export async function createManualEntry(
  actor: User,
  targetUserId: string,
  input: {
    clientId: string;
    categoryId: string;
    taskId?: string | null;
    startAt: Date;
    endAt: Date;
    note?: string | null;
    backdateReason?: string | null;
    allowOverlapOverride?: boolean;
  }
) {
  const isSelf = targetUserId === actor.id;
  // Spec 6.3: "אם אדמין מזין עבור עובד אחר, actor שונה מ-user_id ונרשם
  // ב-Audit" - entering time for someone else requires edit_others, not
  // create_self.
  assertCan(actor.role, isSelf ? "time_entry.create_self" : "time_entry.edit_others");

  assertValidRange(input.startAt, input.endAt);
  // Checks the TARGET employee's own client assignment (spec 4.1's rule
  // is about the employee, not necessarily the actor entering the data) -
  // canAccessClientForTimeEntry's canManageClients(actor.role) branch
  // still applies here, so an admin's own override permission is what
  // lets them enter time for an employee against a client that employee
  // isn't individually assigned to.
  await assertClientAccess({ ...actor, id: targetUserId } as User, input.clientId);
  await assertActiveTargets(actor, input.clientId, input.categoryId);

  if (isBackdated(input.startAt) && !input.backdateReason?.trim()) {
    throw new BackdateReasonRequiredError();
  }

  await assertNoOverlap(actor, targetUserId, input.startAt, input.endAt, !!input.allowOverlapOverride);

  const actualSeconds = Math.round((input.endAt.getTime() - input.startAt.getTime()) / 1000);
  const billableSeconds = await computeEntryBillableSeconds(input.clientId, actualSeconds);

  const entry = await prisma.timeEntry.create({
    data: {
      userId: targetUserId,
      clientId: input.clientId,
      categoryId: input.categoryId,
      taskId: input.taskId ?? null,
      startAt: input.startAt,
      endAt: input.endAt,
      actualSeconds,
      billableSeconds,
      note: input.note?.trim() || null,
      source: "MANUAL",
      isManual: true,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "time_entry.create",
    entityType: "TimeEntry",
    entityId: entry.id,
    clientId: entry.clientId,
    after: { ...entry, backdateReason: input.backdateReason ?? null },
  });

  // Phase 4 (spec 9.2): a manual entry changes consumed minutes just
  // like a stopped timer does - same best-effort, non-fatal trigger.
  await evaluateAlertsForClient(entry.clientId).catch((err) =>
    console.error("evaluateAlertsForClient failed (non-fatal)", err)
  );

  return entry;
}

// ---------------------------------------------------------------------
// Edit + revisions (spec 5.1, 6.4, 18.1 PATCH time-entry)
// ---------------------------------------------------------------------

export async function updateTimeEntry(
  actor: User,
  timeEntryId: string,
  input: {
    clientId?: string;
    categoryId?: string;
    taskId?: string | null;
    startAt?: Date;
    endAt?: Date;
    note?: string | null;
    reason?: string | null;
    allowOverlapOverride?: boolean;
    /// Phase 7 (spec 20 conflict rule) - the entry's `updatedAt` as of
    /// when the caller's edit form was loaded/last refreshed. Optional so
    /// existing callers (tests, the timer-stop flow's own internal
    /// updates) that don't have a "form load time" to compare against are
    /// unaffected; every UI edit form now always sends it.
    expectedUpdatedAt?: Date;
  }
) {
  const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
  const isSelf = entry.userId === actor.id;
  assertCan(actor.role, isSelf ? "time_entry.edit_self" : "time_entry.edit_others");

  if (input.expectedUpdatedAt && input.expectedUpdatedAt.getTime() !== entry.updatedAt.getTime()) {
    throw new ConflictError(entry);
  }

  // Spec 6.4: self-edit window. edit_others (manager+) bypasses it
  // entirely, which is exactly the escape hatch the spec describes
  // ("לאחר מכן נדרשת הרשאת Manager").
  if (isSelf && !can(actor.role, "time_entry.edit_others")) {
    const hoursSinceStart = (Date.now() - entry.startAt.getTime()) / 3_600_000;
    if (hoursSinceStart > SELF_EDIT_WINDOW_HOURS) {
      throw new EditWindowExpiredError();
    }
  }

  const nextStartAt = input.startAt ?? entry.startAt;
  const nextEndAt = input.endAt ?? entry.endAt;
  assertValidRange(nextStartAt, nextEndAt);

  const nextClientId = input.clientId ?? entry.clientId;
  const nextCategoryId = input.categoryId ?? entry.categoryId;
  if (input.clientId || input.categoryId) {
    await assertClientAccess(actor, nextClientId);
    await assertActiveTargets(actor, nextClientId, nextCategoryId);
  }

  if (input.startAt || input.endAt) {
    await assertNoOverlap(
      actor,
      entry.userId,
      nextStartAt,
      nextEndAt,
      !!input.allowOverlapOverride,
      entry.id
    );
  }

  const nextActualSeconds = nextEndAt
    ? Math.round((nextEndAt.getTime() - nextStartAt.getTime()) / 1000)
    : entry.actualSeconds;
  // Phase 3: recompute against the (possibly just-changed) client's
  // policy, not the entry's stale billableSeconds.
  const nextBillableSeconds =
    nextActualSeconds != null ? await computeEntryBillableSeconds(nextClientId, nextActualSeconds) : null;

  const result = await prisma.$transaction(async (tx) => {
    const before = entry;
    const updated = await tx.timeEntry.update({
      where: { id: timeEntryId },
      data: {
        clientId: input.clientId,
        categoryId: input.categoryId,
        taskId: input.taskId,
        startAt: input.startAt,
        endAt: input.endAt,
        note: input.note !== undefined ? input.note?.trim() || null : undefined,
        actualSeconds: nextActualSeconds,
        billableSeconds: nextBillableSeconds,
        isEdited: true,
      },
    });

    // Spec 5.1: "כל עריכה ל-start/end/client/category/task/note/billable
    // duration יוצרת Revision." An immutable, ever-incrementing version
    // per entry (never updated/deleted itself).
    const lastRevision = await tx.timeEntryRevision.findFirst({
      where: { timeEntryId },
      orderBy: { version: "desc" },
    });
    await tx.timeEntryRevision.create({
      data: {
        timeEntryId,
        version: (lastRevision?.version ?? 0) + 1,
        changedById: actor.id,
        beforeJson: before as unknown as Prisma.InputJsonValue,
        afterJson: updated as unknown as Prisma.InputJsonValue,
        reason: input.reason ?? null,
      },
    });

    return { before, updated };
  });

  await recordAudit({
    actorId: actor.id,
    action: "time_entry.update",
    entityType: "TimeEntry",
    entityId: entry.id,
    clientId: result.updated.clientId,
    before: result.before,
    after: result.updated,
  });

  // Spec 8.2: a backdated edit that lands inside an already-closed Hour
  // Bank cycle must flip that cycle to RECALCULATED rather than silently
  // changing its previously-reported numbers. Best-effort - a failure
  // here must never undo the time-entry write itself, which has already
  // committed above.
  await flagAffectedCyclesRecalculated(result.updated.clientId, [entry.startAt, result.updated.startAt]).catch(
    (err) => console.error("flagAffectedCyclesRecalculated failed (non-fatal)", err)
  );

  // Phase 4 (spec 9.2): an edit can change consumed minutes (time
  // range, client, or category) - re-evaluate thresholds for the
  // resulting client. Best-effort/non-fatal, same as the recalculation
  // flag above.
  await evaluateAlertsForClient(result.updated.clientId).catch((err) =>
    console.error("evaluateAlertsForClient failed (non-fatal)", err)
  );

  return result.updated;
}

/// Soft delete only (spec 5.1: "מחיקה היא soft delete; לא hard delete
/// דרך UI. Audit נשמר.").
export async function deleteTimeEntry(actor: User, timeEntryId: string) {
  const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
  const isSelf = entry.userId === actor.id;
  assertCan(actor.role, isSelf ? "time_entry.edit_self" : "time_entry.edit_others");

  const updated = await prisma.timeEntry.update({
    where: { id: timeEntryId },
    data: { deletedAt: new Date() },
  });

  await recordAudit({
    actorId: actor.id,
    action: "time_entry.delete",
    entityType: "TimeEntry",
    entityId: entry.id,
    clientId: entry.clientId,
    before: entry,
  });

  // Spec 8.2: deleting an entry that falls inside an already-closed Hour
  // Bank cycle also changes that cycle's consumed total after the fact -
  // same recalculation flag as an edit, same best-effort guarantee.
  await flagAffectedCyclesRecalculated(entry.clientId, [entry.startAt]).catch((err) =>
    console.error("flagAffectedCyclesRecalculated failed (non-fatal)", err)
  );

  // Phase 4 (spec 9.2): deleting an entry reduces consumed minutes,
  // which can also RESOLVE a previously-fired alert - same
  // best-effort, non-fatal trigger as every other mutation here.
  await evaluateAlertsForClient(entry.clientId).catch((err) =>
    console.error("evaluateAlertsForClient failed (non-fatal)", err)
  );

  return updated;
}

// ---------------------------------------------------------------------
// Reads (power /app/timer, /app/my-time, /app/time-entries)
// ---------------------------------------------------------------------

export async function listMyTimeEntries(userId: string, range?: { from?: Date; to?: Date }) {
  return prisma.timeEntry.findMany({
    where: {
      userId,
      deletedAt: null,
      startAt: { gte: range?.from, lte: range?.to },
    },
    orderBy: { startAt: "desc" },
    include: { client: true, category: true, task: true },
  });
}

export async function listTimeEntriesForAdmin(filters?: {
  clientId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
}) {
  return prisma.timeEntry.findMany({
    where: {
      deletedAt: null,
      clientId: filters?.clientId,
      userId: filters?.userId,
      startAt: { gte: filters?.from, lte: filters?.to },
    },
    orderBy: { startAt: "desc" },
    include: { client: true, category: true, task: true, user: true },
  });
}

export async function getEntryRevisions(timeEntryId: string) {
  return prisma.timeEntryRevision.findMany({
    where: { timeEntryId },
    orderBy: { version: "desc" },
    include: { changedBy: true },
  });
}

/// Spec 6.2: "Recent combinations: לקוח+קטגוריה+Task אחרונים" - powers
/// the Quick Timer screen's recent/favorites picker.
export async function listRecentCombinations(userId: string, limit = 5) {
  const recent = await prisma.timeEntry.findMany({
    where: { userId, deletedAt: null },
    orderBy: { startAt: "desc" },
    take: 20,
    include: { client: true, category: true, task: true },
  });
  const seen = new Set<string>();
  const combos: typeof recent = [];
  for (const entry of recent) {
    const key = `${entry.clientId}:${entry.categoryId}:${entry.taskId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push(entry);
    if (combos.length >= limit) break;
  }
  return combos;
}
