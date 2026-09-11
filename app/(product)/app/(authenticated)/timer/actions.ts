"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import {
  startTimer,
  stopTimer,
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
