"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import {
  createManualEntry,
  updateTimeEntry,
  deleteTimeEntry,
  combineWallClockTime,
  OverlapError,
  EditWindowExpiredError,
  BackdateReasonRequiredError,
  FutureEntryError,
  ConflictError,
} from "@/lib/app-domain/time-entries";
import { ForbiddenError } from "@/lib/app-auth/permissions";

/// Spec "אישור דיווח שעות חופף בין לקוחות שונים" (Phase 12): a cross-client
/// overlap (OverlapError.sameClient === false) is surfaced as a non-fatal,
/// confirmable warning instead of the hard `error` every other validation
/// failure returns - the employee can resubmit the SAME form data with
/// confirmOverlap set to push it through ("שמירה בכל זאת"). A same-client
/// conflict is never offered that choice; it still comes back as `error`,
/// exactly as before this feature.
type OverlapWarning = {
  clientName: string;
  categoryName: string;
  startAt: string;
  endAt: string | null;
};

type FormState = { error?: string; ok?: boolean; overlapWarning?: OverlapWarning };

function friendlyError(err: unknown): string {
  if (err instanceof OverlapError) return "טווח הזמן חופף לדיווח קיים אצל אותו לקוח.";
  if (err instanceof ConflictError)
    return "הרשומה הזו עודכנה בינתיים על ידי מישהו אחר. יש לרענן את הדף ולנסות שוב.";
  if (err instanceof EditWindowExpiredError) return "חלון העריכה העצמית הסתיים; נדרשת הרשאת מנהל.";
  if (err instanceof BackdateReasonRequiredError) return "יש לציין סיבה לדיווח עבור יום קודם.";
  if (err instanceof FutureEntryError) return "לא ניתן לדווח על זמן בעתיד.";
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function overlapWarningFrom(err: OverlapError): OverlapWarning {
  return {
    clientName: err.conflicting.client.name,
    categoryName: err.conflicting.category.name,
    startAt: err.conflicting.startAt.toISOString(),
    endAt: err.conflicting.endAt ? err.conflicting.endAt.toISOString() : null,
  };
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
  const confirmOverlap = formData.get("confirmOverlap") === "true";

  try {
    await createManualEntry(user, user.id, {
      clientId,
      categoryId,
      taskId: null,
      startAt: combineWallClockTime(date, startTime),
      endAt: combineWallClockTime(date, endTime),
      note: String(formData.get("note") || ""),
      backdateReason: String(formData.get("backdateReason") || ""),
      allowOverlapOverride: confirmOverlap,
    });
  } catch (err) {
    if (err instanceof OverlapError && !err.sameClient) {
      return { overlapWarning: overlapWarningFrom(err) };
    }
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

  const expectedUpdatedAtRaw = String(formData.get("expectedUpdatedAt") || "");
  const confirmOverlap = formData.get("confirmOverlap") === "true";

  try {
    await updateTimeEntry(user, timeEntryId, {
      startAt: combineWallClockTime(date, startTime),
      endAt: combineWallClockTime(date, endTime),
      note: String(formData.get("note") || ""),
      reason: String(formData.get("reason") || "") || null,
      allowOverlapOverride: confirmOverlap,
      expectedUpdatedAt: expectedUpdatedAtRaw ? new Date(expectedUpdatedAtRaw) : undefined,
    });
  } catch (err) {
    if (err instanceof OverlapError && !err.sameClient) {
      return { overlapWarning: overlapWarningFrom(err) };
    }
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
