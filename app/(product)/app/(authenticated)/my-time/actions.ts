"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import {
  createManualEntry,
  updateTimeEntry,
  deleteTimeEntry,
  combineWallClockTime,
  OverlapError,
} from "@/lib/app-domain/time-entries";
import { friendlyError, overlapWarningFrom, type ManualEntryFormState } from "./entry-errors";

type FormState = ManualEntryFormState;

/// What an accepted edit wrote, as the row shows it.
///
/// 13.10.2026: the row puts this on screen itself rather than waiting for
/// the re-render `revalidatePath` sends back. That re-render arrives inside
/// the action's response, and in about one save in four the browser did not
/// apply it: the form sat on "שומר..." with the edit already in the
/// database (claude/e2e-silent-and-racing-2026-10-12.md). The server's own
/// answer about what it wrote cannot be lost that way.
export type SavedEntry = {
  id: string;
  startAt: string;
  endAt: string | null;
  actualSeconds: number | null;
  note: string | null;
  isEdited: boolean;
  isOverlapConfirmed: boolean;
  updatedAt: string;
};

type UpdateState = FormState & { entry?: SavedEntry };

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

  revalidatePath("/app/timer");
  return { ok: true };
}

export async function updateMyEntryAction(_prev: UpdateState | undefined, formData: FormData): Promise<UpdateState> {
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

  let updated;
  try {
    updated = await updateTimeEntry(user, timeEntryId, {
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

  revalidatePath("/app/timer");
  return {
    ok: true,
    entry: {
      id: updated.id,
      startAt: updated.startAt.toISOString(),
      endAt: updated.endAt?.toISOString() ?? null,
      actualSeconds: updated.actualSeconds,
      note: updated.note,
      isEdited: updated.isEdited,
      isOverlapConfirmed: updated.isOverlapConfirmed,
      updatedAt: updated.updatedAt.toISOString(),
    },
  };
}

/// 13.10.2026: answers now, so the row can leave the list on the server's
/// word instead of on a re-render that did not always arrive (see
/// SavedEntry above). It used to return nothing at all, which also meant a
/// refused delete looked exactly like a slow one.
export async function deleteMyEntryAction(timeEntryId: string): Promise<FormState> {
  const user = await requireUser();
  if (!timeEntryId) return { error: "נתונים חסרים." };
  try {
    await deleteTimeEntry(user, timeEntryId);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath("/app/timer");
  return { ok: true };
}
