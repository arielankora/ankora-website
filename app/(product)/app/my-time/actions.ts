"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import {
  createManualEntry,
  updateTimeEntry,
  deleteTimeEntry,
  OverlapError,
  EditWindowExpiredError,
  BackdateReasonRequiredError,
} from "@/lib/app-domain/time-entries";
import { ForbiddenError } from "@/lib/app-auth/permissions";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof OverlapError) return "טווח הזמן חופף לדיווח קיים.";
  if (err instanceof EditWindowExpiredError) return "חלון העריכה העצמית הסתיים; נדרשת הרשאת מנהל.";
  if (err instanceof BackdateReasonRequiredError) return "יש לציין סיבה לדיווח עבור יום קודם.";
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function combineDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00`);
}

// Spec 6.3: manual entry - date + start/end, self-only from this screen
// (an admin entering time on behalf of someone else does so from the
// Admin Time Entries screen, where targetUserId can differ from actor.id).
export async function createManualEntryAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const date = String(formData.get("date") || "");
  const startTime = String(formData.get("startTime") || "");
  const endTime = String(formData.get("endTime") || "");
  const clientId = String(formData.get("clientId") || "");
  const categoryId = String(formData.get("categoryId") || "");
  if (!date || !startTime || !endTime || !clientId || !categoryId) {
    return { error: "יש למלא תאריך, שעות, לקוח וקטגוריה." };
  }

  try {
    await createManualEntry(user, user.id, {
      clientId,
      categoryId,
      taskId: null,
      startAt: combineDateTime(date, startTime),
      endAt: combineDateTime(date, endTime),
      note: String(formData.get("note") || ""),
      backdateReason: String(formData.get("backdateReason") || ""),
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/my-time");
  return { ok: true };
}

export async function updateMyEntryAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const timeEntryId = String(formData.get("timeEntryId") || "");
  const date = String(formData.get("date") || "");
  const startTime = String(formData.get("startTime") || "");
  const endTime = String(formData.get("endTime") || "");
  if (!timeEntryId || !date || !startTime || !endTime) {
    return { error: "נתונים חסרים." };
  }

  try {
    await updateTimeEntry(user, timeEntryId, {
      startAt: combineDateTime(date, startTime),
      endAt: combineDateTime(date, endTime),
      note: String(formData.get("note") || ""),
      reason: String(formData.get("reason") || "") || null,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/my-time");
  return { ok: true };
}

export async function deleteMyEntryAction(formData: FormData) {
  const user = await requireUser();
  const timeEntryId = String(formData.get("timeEntryId") || "");
  if (!timeEntryId) return;
  await deleteTimeEntry(user, timeEntryId);
  revalidatePath("/app/my-time");
}
