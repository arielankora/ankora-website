"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { updateTask } from "@/lib/app-domain/tasks";
import { getActiveTimer, startTimer, stopTimer, ActiveTimerExistsError } from "@/lib/app-domain/time-entries";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import type { TaskPriority, TaskStatus } from "@prisma/client";

// Tasks phase 1, the writes behind /app/tasks/[id].
//
// Every one of them goes through lib/app-domain/tasks.ts's updateTask or
// lib/app-domain/time-entries.ts, never straight to Prisma - the close
// rule (assertClosable), the assignee rule (assertAssignable) and the
// one-active-timer guarantee all live in those modules, and a second
// write path around them is how a rule quietly stops applying.

function friendlyError(err: unknown): string {
  if (err instanceof ActiveTimerExistsError) return "כבר קיים טיימר פעיל. יש לעצור אותו קודם.";
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

/// Everything the screen can change about the task itself.
///
/// One action rather than one per field, for the same reason the Tasks
/// row has one: `updateTask` already takes a patch where an absent key
/// means "leave it alone", so eight actions would be eight identical
/// permission checks and eight revalidations of the same three paths.
///
/// `null` is sent deliberately by the screen to clear a field, and
/// `undefined` (an absent key) means untouched. That distinction is the
/// whole contract of TaskPatch, so it is preserved here rather than
/// flattened into empty strings.
export async function updateTaskDetailAction(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  categoryId?: string | null;
  assignedToId?: string | null;
  dueDate?: string | null;
  clientOutcome?: string | null;
  // Tasks phase 2. Who this goes back to, and whether their agreement is
  // required before it closes. `approvedById` and `approvedAt` are not
  // here and never will be: the server writes the signature on the
  // transition, and a signature a browser can post is not one.
  supervisorId?: string | null;
  requiresApproval?: boolean;
  // The three portal fields. They are editable from the Tasks row as
  // well, and they belong here too: this screen is the task's own home,
  // and sending somebody back to a list to change what their client
  // reads is the kind of errand that makes a field stop being filled in.
  clientVisible?: boolean;
  clientTitle?: string | null;
  waitingOnClient?: boolean;
}) {
  const user = await requireUser();
  try {
    const updated = await updateTask(user, input.taskId, {
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: input.status,
      categoryId: input.categoryId,
      assignedToId: input.assignedToId,
      // The screen speaks in "2026-09-24" and the column stores an
      // instant. Parsed here rather than in the browser so the value that
      // reaches the database does not depend on the reader's clock.
      dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
      clientOutcome: input.clientOutcome,
      supervisorId: input.supervisorId,
      requiresApproval: input.requiresApproval,
      clientVisible: input.clientVisible,
      clientTitle: input.clientTitle,
      // The screen says "is it waiting", the column stores "since when".
      // Translated here rather than in the browser, so the timestamp is
      // the server's and cannot be back-dated by a caller - the same
      // reasoning as the Tasks row's own portal action.
      waitingOnClientSince:
        input.waitingOnClient === undefined ? undefined : input.waitingOnClient ? new Date() : null,
    });
    revalidatePath(`/app/tasks/${input.taskId}`);
    revalidatePath("/app/tasks");
    // A status or visibility change on a promise is something a client
    // may be looking at right now, and something the home screen counts.
    revalidatePath("/app/portal");
    revalidatePath("/app");
    return {
      ok: true as const,
      status: updated.status,
      supervisorId: updated.supervisorId,
      requiresApproval: updated.requiresApproval,
      approvedAt: updated.approvedAt?.toISOString() ?? null,
      startedAt: updated.startedAt?.toISOString() ?? null,
      completedAt: updated.completedAt?.toISOString() ?? null,
      clientVisible: updated.clientVisible,
      clientTitle: updated.clientTitle,
      clientOutcome: updated.clientOutcome,
      waitingOnClient: updated.waitingOnClientSince !== null,
    };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

/// Start the clock on this task, from the task.
///
/// Team adoption wired the timer screen to a promise. This is the other
/// direction, and the more common one: a person is looking at the work,
/// not at a picker, and the moment they decide to do it is the moment the
/// clock should start.
///
/// `stopRunning` is the answer to the one thing in the way. The product
/// holds one active timer per person, enforced by a partial unique index,
/// so starting a second is a real decision and not a detail to hide. The
/// screen makes it one click: it already knows a timer is running and on
/// what, says so, and passes this flag when the person says go ahead.
///
/// The category is the task's own. A task with none cannot start a timer
/// here at all, because a time entry without a category cannot be billed
/// and inventing one silently is worse than asking - the screen asks for
/// the category first and this refuses in case it is ever called without.
export async function startTimerForTaskAction(input: { taskId: string; stopRunning?: boolean }) {
  const user = await requireUser();
  try {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, deletedAt: null },
      select: { id: true, clientId: true, categoryId: true, title: true },
    });
    if (!task) return { ok: false as const, error: "המשימה לא נמצאה." };
    if (!task.categoryId) {
      return { ok: false as const, error: "למשימה אין קטגוריה, ודיווח זמן חייב קטגוריה. בחרו קטגוריה ונסו שוב." };
    }

    const running = await getActiveTimer(user.id);
    if (running) {
      if (!input.stopRunning) {
        return { ok: false as const, error: "כבר קיים טיימר פעיל. יש לעצור אותו קודם." };
      }
      // Stopped with no note and no task of its own: whatever that timer
      // was against, this call is not the place to guess it. The stop
      // keeps every field the entry already had.
      await stopTimer(user, running.id);
    }

    const entry = await startTimer(user, {
      clientId: task.clientId,
      categoryId: task.categoryId,
      taskId: task.id,
      // Pre-filled, and editable on the timer screen like any other note.
      // The client's monthly report reads these lines, and a note that
      // names the task is one nobody has to write twice.
      note: task.title,
    });

    revalidatePath(`/app/tasks/${task.id}`);
    revalidatePath("/app/timer");
    revalidatePath("/app/my-time");
    revalidatePath("/app");
    return { ok: true as const, timeEntryId: entry.id, startAt: entry.startAt.toISOString() };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

/// Stop the timer that is running on this task, from this task.
///
/// Only ever called when the running timer's own `taskId` is this task,
/// which the screen checks before it offers the button. Anything else is
/// the timer screen's job, where the stop can ask its own questions.
export async function stopTimerForTaskAction(input: { taskId: string; timeEntryId: string }) {
  const user = await requireUser();
  try {
    await stopTimer(user, input.timeEntryId);
    revalidatePath(`/app/tasks/${input.taskId}`);
    revalidatePath("/app/timer");
    revalidatePath("/app/my-time");
    revalidatePath("/app");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}
