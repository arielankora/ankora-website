"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import {
  createManualEntry,
  updateTimeEntry,
  deleteTimeEntry,
  restoreTimeEntry,
  getEntryRevisions,
  combineWallClockTime,
  OverlapError,
  EditWindowExpiredError,
  BackdateReasonRequiredError,
  FutureEntryError,
  ConflictError,
} from "@/lib/app-domain/time-entries";
import { assertCan, ForbiddenError } from "@/lib/app-auth/permissions";
import { ClosedBankError } from "@/lib/app-domain/closed-bank-guard";
import { closedBankNoticeFrom, closedBankOptionsFrom, type ClosedBankNoticeState } from "../my-time/entry-errors";
import { timed } from "@/lib/slow-log";
import { describeOverlapConflictIn } from "@/lib/time-entry-format";
import { getFormatter, getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";

type FormState = { error?: string; ok?: boolean; closedBank?: ClosedBankNoticeState };

/// ADR 0006: in the reader's language. The sentences are the ones
/// "הזמן שלי" already uses (timeEntries.errors), except the overlap: on
/// this screen it is any overlap, not only one with the same client.
async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("timeEntries.errors");
  if (err instanceof OverlapError) {
    const conflict = describeOverlapConflictIn(
      err.conflicting,
      {
        conflict: (values) => t("overlapConflict", values),
        range: (values) => t("overlapRange", values),
        rangeRunning: (values) => t("overlapRangeRunning", values),
      },
      await getFormatter()
    );
    return (await getTranslations("timeEntriesAdmin.errors"))("overlap", { conflict });
  }
  if (err instanceof ConflictError) return t("conflict");
  if (err instanceof EditWindowExpiredError) return t("editWindowExpired");
  if (err instanceof BackdateReasonRequiredError) return t("backdateReasonRequired");
  if (err instanceof FutureEntryError) return t("futureEntry");
  if (err instanceof ForbiddenError) return t("forbidden");
  const text = await domainErrorText(err);
  if (text) return text;
  if (err instanceof Error) return err.message;
  return t("generic");
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
    return { error: (await getTranslations("timeEntriesAdmin.errors"))("missingFields") };
  }

  try {
    await timed("action.adminCreateEntry", () => createManualEntry(admin, targetUserId, {
      clientId,
      categoryId,
      taskId: null,
      startAt: combineWallClockTime(date, startTime),
      endAt: combineWallClockTime(date, endTime),
      note: String(formData.get("note") || ""),
      backdateReason: String(formData.get("backdateReason") || ""),
      allowOverlapOverride: formData.get("allowOverlapOverride") === "on",
      ...closedBankOptionsFrom(formData),
    }));
  } catch (err) {
    if (err instanceof ClosedBankError) return { closedBank: await closedBankNoticeFrom(err) };
    return { error: await friendlyError(err) };
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
    return { error: (await getTranslations("timeEntriesAdmin.errors"))("missingData") };
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
      closedBankOverride: closedBankOptionsFrom(formData).closedBankOverride,
    });
  } catch (err) {
    if (err instanceof ClosedBankError) return { closedBank: await closedBankNoticeFrom(err) };
    return { error: await friendlyError(err) };
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

// App redesign (handoff README, screen 9): plain async functions (not
// <form action>) so the row/table can read back success/failure and wire a
// REAL undo (restoreEntryAction) into the toast - same pattern as
// clients/actions.ts's archiveClientAction/restoreClientAction. Kept
// alongside the older FormData-based adminDeleteEntryAction above (still
// used nowhere critical) rather than breaking its signature.
export async function deleteEntryAction(timeEntryId: string, closedBankOverrideReason?: string) {
  const admin = await requireUser();
  try {
    await deleteTimeEntry(admin, timeEntryId, {
      closedBankOverride: closedBankOverrideReason?.trim() ? { reason: closedBankOverrideReason.trim() } : null,
    });
  } catch (err) {
    if (err instanceof ClosedBankError) {
      const closedBank = await closedBankNoticeFrom(err);
      return { ok: false as const, error: closedBank.message, closedBank };
    }
    return { ok: false as const, error: await friendlyError(err) };
  }
  revalidatePath("/app/time-entries");
  return { ok: true as const };
}

export async function restoreEntryAction(timeEntryId: string, closedBankOverrideReason?: string) {
  const admin = await requireUser();
  try {
    // The undo of a delete that overrode a closed bank carries the same
    // reason, so the undo is not refused by the rule it was granted under.
    await restoreTimeEntry(admin, timeEntryId, {
      closedBankOverride: closedBankOverrideReason?.trim() ? { reason: closedBankOverrideReason.trim() } : null,
    });
  } catch (err) {
    return { ok: false as const, error: await friendlyError(err) };
  }
  revalidatePath("/app/time-entries");
  return { ok: true as const };
}

// App redesign (handoff README, screen 9): "בחירה מרובה ... אישור מסומנים
// (עם ביטול)". No "approval" concept exists on TimeEntry (see
// restoreTimeEntry's comment in lib/app-domain/time-entries.ts) so the
// bulk action this wires up is bulk delete - the one bulk-worthy capability
// that's actually real here. Returns per-id results so the toolbar can
// report partial failures (e.g. one entry outside the actor's edit window)
// instead of a single all-or-nothing message.
export async function bulkDeleteEntriesAction(timeEntryIds: string[]) {
  const admin = await requireUser();
  const failed: string[] = [];
  for (const id of timeEntryIds) {
    try {
      await deleteTimeEntry(admin, id);
    } catch {
      failed.push(id);
    }
  }
  revalidatePath("/app/time-entries");
  return { deleted: timeEntryIds.filter((id) => !failed.includes(id)), failed };
}

export async function bulkRestoreEntriesAction(timeEntryIds: string[]) {
  const admin = await requireUser();
  for (const id of timeEntryIds) {
    await restoreTimeEntry(admin, id).catch(() => {});
  }
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
    /// null: a change by the system, which the row names in the reader's
    /// language.
    changedByName: r.changedBy?.name ?? null,
    reason: r.reason,
    beforeJson: r.beforeJson,
    afterJson: r.afterJson,
  }));
}
