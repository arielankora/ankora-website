"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import {
  createManualEntry,
  updateTimeEntry,
  deleteTimeEntry,
  getEntryRevisions,
  combineWallClockTime,
  OverlapError,
  EditWindowExpiredError,
  BackdateReasonRequiredError,
  ConflictError,
} from "@/lib/app-domain/time-entries";
import { assertCan, ForbiddenError } from "@/lib/app-auth/permissions";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof OverlapError) return "טווח הזמן חופף לדיווח קיים.";
  if (err instanceof ConflictError)
    return "הרשומה הזו עודכנה בינתיים על ידי מישהו אחר. יש לרענן את הדף ולנסות שוב.";
  if (err instanceof EditWindowExpiredError) return "חלון העריכה העצמית הסתיים; נדרשת הרשאת מנהל.";
  if (err instanceof BackdateReasonRequiredError) return "יש לציין סיבה לדיווח עבור יום קודם.";
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

/// Spec 6.3: "אם אדמין מזין עבור עובד אחר, actor שונה מ-user_id ונרשם
/// ב-Audit" - targetUserId comes from the form, actor is always the
/// logged-in admin (requireUser()), never trusted from the client.
export async function adminCreateEntryAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const admin = await requireUser();
  const targetUserId = String(formData.get("userId") || "");
  const date = String(formData.get("date") || "");
  const startTime = String(formData.get("startTime") || "");
  const endTime = String(formData.get("endTime") || "");
  const clientId = String(formData.get("clientId") || "");
  const categoryId = String(formData.get("categoryId") || "");
  if (!targetUserId || !date || !startTime || !endTime || !clientId || !categoryId) {
    return { error: "יש למלא עובד, תאריך, שעות, לקוח וקטגוריה." };
  }

  try {
    await createManualEntry(admin, targetUserId, {
      clientId,
      categoryId,
      taskId: null,
      startAt: combineWallClockTime(date, startTime),
      endAt: combineWallClockTime(date, endTime),
      note: String(formData.get("note") || ""),
      backdateReason: String(formData.get("backdateReason") || ""),
      allowOverlapOverride: formData.get("allowOverlapOverride") === "on",
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/time-entries");
  return { ok: true };
}

export async function adminUpdateEntryAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const admin = await requireUser();
  const timeEntryId = String(formData.get("timeEntryId") || "");
  const date = String(formData.get("date") || "");
  const startTime = String(formData.get("startTime") || "");
  const endTime = String(formData.get("endTime") || "");
  if (!timeEntryId || !date || !startTime || !endTime) {
    return { error: "נתונים חסרים." };
  }

  const expectedUpdatedAtRaw = String(formData.get("expectedUpdatedAt") || "");

  try {
    await updateTimeEntry(admin, timeEntryId, {
      startAt: combineWallClockTime(date, startTime),
      endAt: combineWallClockTime(date, endTime),
      note: String(formData.get("note") || ""),
      reason: String(formData.get("reason") || "") || null,
      allowOverlapOverride: formData.get("allowOverlapOverride") === "on",
      expectedUpdatedAt: expectedUpdatedAtRaw ? new Date(expectedUpdatedAtRaw) : undefined,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/time-entries");
  return { ok: true };
}

export async function adminDeleteEntryAction(formData: FormData) {
  const admin = await requireUser();
  const timeEntryId = String(formData.get("timeEntryId") || "");
  if (!timeEntryId) return;
  await deleteTimeEntry(admin, timeEntryId);
  revalidatePath("/app/time-entries");
}

/// Spec 18.1's PATCH time-entry implies revisions are readable wherever
/// edits are made; spec 12's Admin "Time Entries" screen explicitly lists
/// "revisions" among that screen's requirements. Lazy-loaded on demand
/// from the client rather than joined into the main list query, since
/// most rows have zero revisions.
export async function getEntryRevisionsAction(timeEntryId: string) {
  const admin = await requireUser();
  // Gated on the same permission as the rest of this screen
  // (time_entry.edit_others), not the separate system-wide audit.view -
  // ANKORA_ADMIN can reach this screen without audit.view (Phase 1's
  // conservative default keeps that Super-Admin-only), and viewing a
  // single entry's edit history is a natural extension of being allowed
  // to edit it, not a system-audit capability.
  assertCan(admin.role, "time_entry.edit_others");
  const revisions = await getEntryRevisions(timeEntryId);
  return revisions.map((r) => ({
    id: r.id,
    version: r.version,
    changedAt: r.changedAt.toISOString(),
    changedByName: r.changedBy?.name ?? "מערכת",
    reason: r.reason,
    beforeJson: r.beforeJson,
    afterJson: r.afterJson,
  }));
}
