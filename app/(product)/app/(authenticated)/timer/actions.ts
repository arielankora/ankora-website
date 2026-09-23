"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import {
  startTimer,
  stopTimer,
  reopenTimer,
  updateActiveTimerNote,
  deleteTimeEntry,
  ActiveTimerExistsError,
  EditWindowExpiredError,
} from "@/lib/app-domain/time-entries";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { updateTask } from "@/lib/app-domain/tasks";

function friendlyError(err: unknown): string {
  if (err instanceof ActiveTimerExistsError) return "כבר קיים טיימר פעיל. יש לעצור אותו קודם.";
  if (err instanceof EditWindowExpiredError) return "חלון העריכה העצמית הסתיים; נדרשת הרשאת מנהל.";
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

export async function startTimerAction(input: {
  clientId: string;
  categoryId: string;
  note?: string;
  // Team adoption: which promise this time is against. Optional, because
  // plenty of work is not a promise, and a required field here would be
  // the extra step the whole mechanism exists to avoid.
  taskId?: string | null;
}) {
  const user = await requireUser();
  try {
    const entry = await startTimer(user, {
      clientId: input.clientId,
      categoryId: input.categoryId,
      note: input.note || null,
      taskId: input.taskId || null,
    });
    revalidatePath("/app/timer");
    revalidatePath("/app/my-time");
    return { ok: true as const, entry };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

export async function stopTimerAction(input: { timeEntryId: string; note?: string; taskId?: string | null }) {
  const user = await requireUser();
  try {
    // `taskId` is accepted on the stop as well as the start, because the
    // promise a person was working on is often only obvious once they
    // have finished. Passing it here attaches the whole entry.
    const entry = await stopTimer(user, input.timeEntryId, {
      note: input.note,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    });
    revalidatePath("/app/timer");
    revalidatePath("/app/my-time");
    return { ok: true as const, entry };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

// App redesign (handoff README, Interactions & Behavior rule 2): real
// undo for "עצירת טיימר" - re-opens the just-stopped entry so it resumes
// counting from its original start time.
export async function reopenTimerAction(input: { timeEntryId: string }) {
  const user = await requireUser();
  try {
    const entry = await reopenTimer(user, input.timeEntryId);
    revalidatePath("/app/timer");
    revalidatePath("/app/my-time");
    return { ok: true as const, entry };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

// App redesign (handoff README, screen 2): "מחיקה ללא שמירה" - discards
// the running timer entirely. Routed through the same soft-delete +
// audit path every other time-entry delete uses (spec 5.1: no hard
// DELETE via the UI).
export async function discardActiveTimerAction(input: { timeEntryId: string }) {
  const user = await requireUser();
  try {
    await deleteTimeEntry(user, input.timeEntryId);
    revalidatePath("/app/timer");
    revalidatePath("/app/my-time");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

// App redesign (handoff README, screen 2): "שדה הערה שנשמר תוך כדי
// ריצה" - debounced client-side autosave of the running timer's note.
// No revalidatePath: this is a background scratchpad save, not a
// user-visible navigation moment, and the eventual Stop already carries
// the final note through revalidation.
export async function updateActiveTimerNoteAction(input: { timeEntryId: string; note: string }) {
  const user = await requireUser();
  try {
    await updateActiveTimerNote(user, input.timeEntryId, input.note);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

// Team adoption, mechanism one: the answer to the question the stop
// asks.
//
// Three stages, one call. The alternative was to reuse the Tasks
// screen's two actions - one for the status, one for the waiting flag -
// which would have made "מחכה ללקוח" two writes and left a window where
// a promise was in progress and already waiting.
//
// DONE carries the outcome sentence with it because the domain refuses
// the close without one. The toast asks for it in the same breath, which
// is the point: the moment a person stops the clock is the moment they
// can say what came of it in one line, and any later moment is a moment
// they are somewhere else.
export async function recordPromiseStageAction(input: {
  taskId: string;
  stage: "IN_PROGRESS" | "WAITING_ON_CLIENT" | "DONE";
  clientOutcome?: string;
}) {
  const user = await requireUser();
  try {
    const updated = await updateTask(user, input.taskId, {
      status: input.stage === "DONE" ? "DONE" : "IN_PROGRESS",
      // Clearing it on the two non-waiting stages matters: a promise
      // that was waiting on the client and is now being worked on again
      // must stop telling the client it is their turn.
      waitingOnClientSince: input.stage === "WAITING_ON_CLIENT" ? new Date() : null,
      clientOutcome: input.clientOutcome,
    });
    revalidatePath("/app/timer");
    revalidatePath("/app/tasks");
    revalidatePath("/app/portal");
    revalidatePath("/app");
    return { ok: true as const, status: updated.status };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}
