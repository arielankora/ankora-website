"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { updateTask } from "@/lib/app-domain/tasks";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { isDayKey } from "@/lib/calendar-keys";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";

// The calendar's one write: a task's due date, from a drag.
//
// It goes through `updateTask` like every other edit, so the audit row
// ("תאריך יעד"), the access check and every rule that protects a task
// apply here exactly as on the task screen. The day arrives as a key and
// is stored the way the task screen stores it (UTC midnight of that
// day), which every reader turns back into the same Israel day.

export async function setTaskDueDateAction(input: {
  taskId: string;
  /// "YYYY-MM-DD", or null to remove the due date.
  dueDate: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const t = await getTranslations("calendar.errors");
  if (input.dueDate !== null && !isDayKey(input.dueDate)) return { ok: false, error: t("invalidDate") };
  try {
    await updateTask(user, input.taskId, { dueDate: input.dueDate ? new Date(input.dueDate) : null });
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: t("forbidden") };
    const text = await domainErrorText(err);
    if (text) return { ok: false, error: text };
    return { ok: false, error: err instanceof Error ? err.message : t("generic") };
  }
  revalidatePath("/app/calendar");
  revalidatePath("/app/tasks");
  revalidatePath(`/app/tasks/${input.taskId}`);
  // A due date is on the client's portal when the task is visible there.
  revalidatePath("/app/portal");
  revalidatePath("/app");
  return { ok: true };
}
