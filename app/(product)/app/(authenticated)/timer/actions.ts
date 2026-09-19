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

function friendlyError(err: unknown): string {
  if (err instanceof ActiveTimerExistsError) return "כבר קיים טיימר פעיל. יש לעצור אותו קודם.";
  if (err instanceof EditWindowExpiredError) return "חלון העריכה העצמית הסתיים; נדרשת הרשאת מנהל.";
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

export async function startTimerAction(input: { clientId: string; categoryId: string; note?: string }) {
  const user = await requireUser();
  try {
    const entry = await startTimer(user, {
      clientId: input.clientId,
      categoryId: input.categoryId,
      note: input.note || null,
    });
    revalidatePath("/app/timer");
    revalidatePath("/app/my-time");
    return { ok: true as const, entry };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

export async function stopTimerAction(input: { timeEntryId: string; note?: string }) {
  const user = await requireUser();
  try {
    const entry = await stopTimer(user, input.timeEntryId, { note: input.note });
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
