import "server-only";
import type { ProcessStepMode, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { localDateKey, TIMEZONE } from "@/lib/timezone";
import { isBusinessCalendarKey, type BusinessCalendarKey } from "@/lib/business-calendar";
import { calendarOfProcess } from "@/lib/app-domain/date-calendars";
import { processGaps, readSteps } from "@/lib/process-rules";
import { ruleLine, isExceptionInForce } from "@/lib/client-policies";
import { canCopyIntoTask } from "@/lib/knowledge";
import { readReviewReason, REVIEW_REASON_LABELS } from "@/lib/process-review";
import { runDescription, stepDueKeys, stepTitle } from "@/lib/process-runs";
import { assertClientAccess } from "@/lib/app-domain/client-sources";

// Org brain, phase 1: a run of a process (claude/org-brain-spec-2026-10-12.md,
// 3.12, 5.3). A run is a task: the process's title, the approved
// procedure's steps as the task's steps, each due on its business day,
// and a description that carries what the person needs to run it without
// asking anyone: the highlights, the gaps, the client's rules that apply,
// the exceptions approved for now, and what to do when something deviates.
//
// The run remembers the version it came from. A procedure changed while a
// run is under way changes the next run, not this one.

export const RUN_OPENED = "process.run_opened";

/// The business calendar of a run (decision 6): the one set on the
/// process, otherwise its entity's country ("US" for NUX Inc), otherwise
/// the date's, otherwise Israel.
async function calendarFor(process: { code: string; title: string; businessCalendar: string | null; entityId: string | null }, fallback: string | null | undefined): Promise<BusinessCalendarKey> {
  const c = await calendarOfProcess(process);
  if (c) return c.key;
  return isBusinessCalendarKey(fallback) ? fallback : "IL";
}

function dayAt(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

export type OpenRunInput = {
  processId: string;
  /// The day the process is for (the date's occurrence), any time on it.
  occurrence: Date;
  /// From a date: the date, its occurrence key and its calendar.
  importantDateId?: string | null;
  occurrenceKey?: string | null;
  dateCalendar?: string | null;
  /// Who the run goes to when the process has no owner (the date's
  /// responsible person).
  fallbackAssigneeId?: string | null;
  fallbackCategoryId?: string | null;
  /// Null for the daily job.
  actorId: string | null;
};

/// Opens the run, or returns null when the process cannot run: retired,
/// paused, or without an approved procedure.
export async function openProcessRun(input: OpenRunInput) {
  const process = await prisma.process.findUnique({
    where: { id: input.processId },
    include: { versions: { where: { status: "APPROVED" }, take: 1 } },
  });
  if (!process || process.deletedAt || process.status !== "ACTIVE") return null;
  const version = process.versions[0];
  if (!version) return null;
  const steps = readSteps(version.steps);
  const calendar = await calendarFor(process, input.dateCalendar);
  const runKey = localDateKey(input.occurrence, TIMEZONE);
  const now = new Date();

  const [policies, exceptions, systems] = await Promise.all([
    prisma.clientPolicy.findMany({
      where: { clientId: process.clientId, deletedAt: null, status: { not: "RETIRED" }, kind: { notIn: ["DATA_HANDLING", "DISCLOSURE"] } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.policyException.findMany({ where: { clientId: process.clientId, status: "APPROVED" }, include: { policy: { select: { title: true } } } }),
    prisma.systemAccess.findMany({ where: { clientId: process.clientId, deletedAt: null }, select: { id: true, systemName: true, accessStatus: true } }),
  ]);
  const systemById = new Map(systems.map((s) => [s.id, s]));
  const needed = [...new Set([...process.requiredSystemIds, ...steps.flatMap((s) => s.systemIds)])];
  const gaps = processGaps(
    {
      ...process,
      systemsWithoutAccess: needed.filter((id) => {
        const s = systemById.get(id);
        return !s || (s.accessStatus !== "HAS_ACCESS" && s.accessStatus !== "NOT_NEEDED");
      }),
      nextDate: input.occurrence,
    },
    (id) => systemById.get(id)?.systemName ?? "מערכת שהוסרה"
  );
  // A run opened while the procedure needs review says so first: whoever
  // works it is about to follow a procedure someone has to look at.
  const review = readReviewReason(process.reviewReason);
  if (review) gaps.unshift(`הנוהל דורש סקירה: ${REVIEW_REASON_LABELS[review]}. לבדוק מול כללי הלקוח בתיק לפני שמבצעים.`);
  // Who signs an approval step, by name (spec 5.3). Someone at Ankora is
  // a signature in the product: the step waits for them. A contact at the
  // client is named, and the approval is collected from them outside.
  const [approverUser, approverContact] = await Promise.all([
    process.approverUserId ? prisma.user.findFirst({ where: { id: process.approverUserId, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true } }) : null,
    process.approverContactId ? prisma.clientContact.findFirst({ where: { id: process.approverContactId, deletedAt: null }, select: { role: true, person: { select: { name: true } } } }) : null,
  ]);
  const approverText = approverUser?.name ?? approverContact?.person.name ?? approverContact?.role ?? process.approverText;

  const assignee = process.ownerId ?? input.fallbackAssigneeId ?? null;
  const description = runDescription({
    code: process.code,
    title: process.title,
    version: version.version,
    purpose: process.purpose,
    steps,
    highlights: version.highlights,
    outputs: version.outputs,
    gaps,
    // The run is a task every one on the client reads, and Claude with
    // them: a sensitive or restricted rule stays in the file.
    rules: policies.filter(canCopyIntoTask).map(ruleLine).filter((l): l is string => !!l),
    exceptions: exceptions
      .filter((e) => isExceptionInForce(e, now))
      .map((e) => `${e.policy.title}: ${e.what}, עד ${e.validUntil.toISOString().slice(0, 10).split("-").reverse().join(".")}`),
    exceptionPlaybook: process.exceptionPlaybook,
    systemName: (id) => systemById.get(id)?.systemName ?? "מערכת שהוסרה",
  });
  const dueKeys = stepDueKeys(runKey, steps, calendar);

  const run = await prisma.task.create({
    data: {
      clientId: process.clientId,
      categoryId: process.categoryId ?? input.fallbackCategoryId ?? null,
      title: `${process.code} ${process.title}`.slice(0, 200),
      description,
      assignedToId: assignee,
      dueDate: dayAt(runKey),
      importantDateId: input.importantDateId ?? null,
      importantDateOccurrenceKey: input.occurrenceKey ?? null,
      processId: process.id,
      processVersionId: version.id,
    },
  });
  for (const [i, step] of steps.entries()) {
    await prisma.task.create({
      data: {
        clientId: process.clientId,
        parentId: run.id,
        title: stepTitle(step, approverText),
        assignedToId: assignee,
        dueDate: dayAt(dueKeys[i]),
        stepMode: step.mode as ProcessStepMode,
        processId: process.id,
        processVersionId: version.id,
        // An approval step with an approver at Ankora: it reaches done only
        // through their signature (the task gate, assertApprovable).
        ...(step.requiresApproval && approverUser ? { requiresApproval: true, supervisorId: approverUser.id } : {}),
      },
    });
  }
  await prisma.process.update({ where: { id: process.id }, data: { lastRunAt: now } });
  if (assignee && assignee !== input.actorId) {
    await prisma.notification.create({
      data: {
        userId: assignee,
        type: RUN_OPENED,
        title: `נפתחה ריצה: ${process.code} ${process.title}`.slice(0, 200),
        body: `${steps.length} שלבים, לפי נוהל גרסה ${version.version}. הראשון ב-${dueKeys.length ? dueKeys.slice().sort()[0].split("-").reverse().join(".") : runKey.split("-").reverse().join(".")}.`,
        entityType: "Task",
        entityId: run.id,
      },
    });
  }
  await recordAudit({
    actorId: input.actorId,
    action: "process.run_open",
    entityType: "Task",
    entityId: run.id,
    clientId: process.clientId,
    after: { processId: process.id, code: process.code, version: version.version, steps: steps.length, importantDateId: input.importantDateId ?? null },
  });
  return run;
}

/// A run started by a person: an event happened (an employee's trip, a
/// request for equipment), or someone asked for it. For the given day.
export async function startProcessRun(actor: User, processId: string, day: Date) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await prisma.process.findUnique({ where: { id: processId } });
  if (!process || process.deletedAt) throw new Error("התהליך לא נמצא.");
  await assertClientAccess(actor, process.clientId);
  if (process.status === "PAUSED") throw new Error("התהליך מושהה. מנהל מחדש אותו לפני שפותחים ריצה.");
  if (process.status !== "ACTIVE") throw new Error("לתהליך עוד אין נוהל מאושר.");
  if (process.triggerKinds.length === 1 && process.triggerKinds[0] === "CONTINUOUS") {
    throw new Error("תהליך שוטף לא נפתח כריצה. הוא רץ כל הזמן, ונבדק בסקירה התקופתית.");
  }
  if (Number.isNaN(day.getTime())) throw new Error("צריך תאריך לריצה.");
  const run = await openProcessRun({ processId, occurrence: day, actorId: actor.id, fallbackAssigneeId: actor.id });
  if (!run) throw new Error("לא ניתן לפתוח ריצה לתהליך הזה.");
  return run;
}

/// Recent runs of a process, newest first, for its card.
export async function listProcessRuns(actor: User, processId: string, take = 5) {
  const process = await prisma.process.findUnique({ where: { id: processId }, select: { clientId: true } });
  if (!process) return [];
  await assertClientAccess(actor, process.clientId);
  return prisma.task.findMany({
    where: { processId, parentId: null, deletedAt: null },
    orderBy: { dueDate: "desc" },
    take,
    select: { id: true, title: true, status: true, dueDate: true },
  });
}

/// What a check of an ongoing process found wrong, as work: an OPEN task
/// on the process, for the person who found it, due today. The same
/// promise as a run: it creates, it never closes, and the client does not
/// see it.
export async function openCheckIssueTask(input: {
  processId: string;
  clientId: string;
  code: string;
  title: string;
  note: string;
  assigneeId: string;
  categoryId: string | null;
  day: Date;
}) {
  return prisma.task.create({
    data: {
      clientId: input.clientId,
      categoryId: input.categoryId,
      title: `${input.code} ${input.title}: ${input.note}`.slice(0, 200),
      description: `נמצא בבדיקה השוטפת של ${input.code} ${input.title}.\n\n${input.note}`,
      assignedToId: input.assigneeId,
      dueDate: input.day,
      processId: input.processId,
    },
  });
}
