"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { timed, trace } from "@/lib/slow-log";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  createImportantDate,
  updateImportantDate,
  updateImportantDateStatus,
  snoozeImportantDate,
  deleteImportantDate,
  setHolidayCalendarSubscription,
  ConflictError,
} from "@/lib/app-domain/important-dates";
import type { ImportantDateCategory, ImportantDateSensitivity, ImportantDateStatus, CalendarType, RecurrenceType } from "@prisma/client";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof ConflictError) return "המועד עודכן על ידי מישהו אחר בינתיים. רעננו את העמוד ונסו שוב.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function parseImportantDateFormData(formData: FormData) {
  const month = Number(formData.get("month"));
  const day = Number(formData.get("day"));
  const originYearRaw = String(formData.get("originYear") || "").trim();
  const customIntervalDaysRaw = String(formData.get("customIntervalDays") || "").trim();
  const onceDateRaw = String(formData.get("onceDate") || "").trim();
  const autoTaskLeadDaysRaw = String(formData.get("autoTaskLeadDays") || "").trim();

  return {
    clientId: String(formData.get("clientId") || ""),
    title: String(formData.get("title") || "").trim(),
    type: String(formData.get("type") || "").trim(),
    category: String(formData.get("category") || "") as ImportantDateCategory,
    relatedEntityType: String(formData.get("relatedEntityType") || "").trim() || null,
    relatedEntityName: String(formData.get("relatedEntityName") || "").trim() || null,
    relationToClient: String(formData.get("relationToClient") || "").trim() || null,
    calendarType: String(formData.get("calendarType") || "GREGORIAN") as CalendarType,
    month,
    day,
    originYear: originYearRaw ? Number(originYearRaw) : null,
    recurrence: String(formData.get("recurrence") || "ANNUAL") as RecurrenceType,
    customIntervalDays: customIntervalDaysRaw ? Number(customIntervalDaysRaw) : null,
    onceDate: onceDateRaw ? new Date(`${onceDateRaw}T00:00:00Z`) : null,
    responsibleUserId: String(formData.get("responsibleUserId") || ""),
    additionalUserIds: [],
    extraEmailRecipients: String(formData.get("extraEmailRecipients") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    sensitivity: (String(formData.get("sensitivity") || "") || undefined) as ImportantDateSensitivity | undefined,
    notes: String(formData.get("notes") || "").trim() || null,
    createAutoTask: formData.get("createAutoTask") === "on",
    autoTaskLeadDays: autoTaskLeadDaysRaw ? Number(autoTaskLeadDaysRaw) : null,
    autoTaskCategoryId: String(formData.get("autoTaskCategoryId") || "") || null,
    // Same fix as the document visibility toggle, and the same bug: an
    // unchecked box is absent from the form data, so `!== "off"` read
    // every unticked "add the default reminders" as a yes. Older than
    // the portal; found while fixing its twin.
    useDefaultReminders: formData.get("useDefaultReminders") === "on",
  };
}

export async function createImportantDateAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  // Silent unless the browser suite is running. See lib/slow-log.ts: the
  // browser saw this POST aborted at 50ms with no row written, and only
  // the server can say whether it ever arrived.
  trace("createImportantDateAction: in");
  const user = await requireUser();
  const input = parseImportantDateFormData(formData);

  if (!input.clientId) return { error: "יש לבחור לקוח." };
  if (!input.title) return { error: "יש להזין כותרת." };
  if (!input.category) return { error: "יש לבחור קטגוריה." };
  if (!input.responsibleUserId) return { error: "יש לבחור אחראי." };

  // A ONCE date carries its whole date in `onceDate`; the form renders that
  // field INSTEAD of month/day, so both arrive empty. This validation ran
  // unconditionally and rejected every one-off date with "חודש לא תקין",
  // which no amount of filling the form could get past - the field it named
  // is not on screen for that recurrence. Found by the browser suite; the
  // one-off path had no coverage before it.
  //
  // month/day are NOT NULL columns and are, by the schema's own comment,
  // ignored for ONCE - so they are derived from the chosen date rather than
  // made nullable, which would be a migration for no behavioural gain.
  if (input.recurrence === "ONCE") {
    if (!input.onceDate || Number.isNaN(input.onceDate.getTime())) return { error: "יש לבחור תאריך." };
    input.month = input.onceDate.getUTCMonth() + 1;
    input.day = input.onceDate.getUTCDate();
  } else {
    if (!input.month || input.month < 1 || input.month > 13) return { error: "חודש לא תקין." };
    if (!input.day || input.day < 1 || input.day > 31) return { error: "יום לא תקין." };
  }

  trace("createImportantDateAction: writing");
  try {
    await createImportantDate(user, input);
  } catch (err) {
    trace("createImportantDateAction: out (refused)");
    return { error: friendlyError(err) };
  }
  trace("createImportantDateAction: written");

  // Measured around the revalidations, not only around the write: the
  // last run proved the write itself is fast (no [slow] line from
  // createImportantDate) while the button still sat at "נוצר..." for
  // thirty seconds, so the time is somewhere after the row is committed.
  // revalidatePath("/app") is the first suspect - it invalidates the
  // dashboard, whose re-render Next ships back inside this action's own
  // response. See lib/slow-log.ts.
  await timed("action.createImportantDate.revalidate", async () => {
    revalidatePath("/app/important-dates");
    revalidatePath("/app");
  });
  trace("createImportantDateAction: out (ok)");
  return { ok: true };
}

export async function updateImportantDateAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return { error: "מועד לא נמצא." };

  const input = parseImportantDateFormData(formData);
  const expectedUpdatedAtRaw = String(formData.get("expectedUpdatedAt") || "");

  if (!input.title) return { error: "יש להזין כותרת." };

  try {
    await updateImportantDate(user, id, {
      ...input,
      expectedUpdatedAt: expectedUpdatedAtRaw ? new Date(expectedUpdatedAtRaw) : undefined,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/important-dates");
  revalidatePath(`/app/important-dates/${id}`);
  revalidatePath("/app");
  return { ok: true };
}

export async function updateImportantDateStatusAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("importantDateId") || "");
  const status = String(formData.get("status") || "") as ImportantDateStatus;
  if (!id || !status) return;

  await updateImportantDateStatus(user, id, status);
  revalidatePath("/app/important-dates");
  revalidatePath(`/app/important-dates/${id}`);
  revalidatePath("/app");
}

// App redesign (handoff README, screen 7 "מועדים חשובים"): "כפתור 'סימון
// כטופל' (עם ביטול)" - a plain async function (not <form action>) so
// ImportantDateRow can read back the result and wire a real undo (calling
// this again with the previous status) into the toast, matching tasks/
// actions.ts's toggleTaskDoneAction from the daily-screens phase.
export async function setImportantDateStatusAction(id: string, status: ImportantDateStatus) {
  const user = await requireUser();
  try {
    const updated = await updateImportantDateStatus(user, id, status);
    revalidatePath("/app/important-dates");
    revalidatePath(`/app/important-dates/${id}`);
    revalidatePath("/app");
    return { ok: true as const, status: updated.status };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

export async function snoozeImportantDateAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("importantDateId") || "");
  const untilRaw = String(formData.get("snoozedUntil") || "");
  if (!id || !untilRaw) return;

  await snoozeImportantDate(user, id, new Date(`${untilRaw}T00:00:00Z`));
  revalidatePath("/app/important-dates");
  revalidatePath(`/app/important-dates/${id}`);
}

export async function deleteImportantDateAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("importantDateId") || "");
  if (!id) return;

  await deleteImportantDate(user, id);
  revalidatePath("/app/important-dates");
  redirect("/app/important-dates");
}

// Phase 10 follow-up: holiday-calendar subscription toggle, called
// directly from HolidayCalendarsPanel.tsx (client component), same
// pattern as alerts/RuleActions.tsx -> toggleAlertRuleAction (positional
// args, no FormData). setHolidayCalendarSubscription() itself enforces
// important_date.manage_catalog (SUPER_ADMIN-only) and client access.
export async function toggleHolidayCalendarSubscriptionAction(
  clientId: string,
  calendarKey: string,
  enabled: boolean
): Promise<void> {
  const user = await requireUser();
  await setHolidayCalendarSubscription(user, clientId, calendarKey, { enabled });
  revalidatePath(`/app/clients/${clientId}`);
  revalidatePath("/app/important-dates");
}
