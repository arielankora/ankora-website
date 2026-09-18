"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
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
    useDefaultReminders: formData.get("useDefaultReminders") !== "off",
  };
}

export async function createImportantDateAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const input = parseImportantDateFormData(formData);

  if (!input.clientId) return { error: "יש לבחור לקוח." };
  if (!input.title) return { error: "יש להזין כותרת." };
  if (!input.category) return { error: "יש לבחור קטגוריה." };
  if (!input.responsibleUserId) return { error: "יש לבחור אחראי." };
  if (!input.month || input.month < 1 || input.month > 13) return { error: "חודש לא תקין." };
  if (!input.day || input.day < 1 || input.day > 31) return { error: "יום לא תקין." };

  try {
    await createImportantDate(user, input);
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/important-dates");
  revalidatePath("/app");
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
