"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  createReportSchedule,
  updateReportSchedule,
  deleteReportSchedule,
  sendReportScheduleNow,
} from "@/lib/app-domain/report-schedules";
import type { ClientReportType, ReportFrequency } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";

type FormState = { error?: string; ok?: boolean };

/// ADR 0006: in the reader's language.
async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("reportSchedules.errors");
  if (err instanceof ForbiddenError) return t("forbidden");
  const text = await domainErrorText(err);
  if (text) return text;
  if (err instanceof Error) return err.message;
  return t("generic");
}

function parseEmailList(value: FormDataEntryValue | null): string[] {
  if (!value) return [];
  return String(value)
    .split(/[,\n]/)
    .map((e) => e.trim())
    .filter(Boolean);
}

export async function createReportScheduleAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: (await getTranslations("reportSchedules.errors"))("pickClient") };

  const reportType = String(formData.get("reportType") || "MONTHLY_DETAILED") as ClientReportType;
  const frequency = String(formData.get("frequency") || "MONTHLY") as ReportFrequency;
  const recipients = parseEmailList(formData.get("recipients"));
  if (recipients.length === 0) return { error: (await getTranslations("reportSchedules.errors"))("recipientsRequired") };

  try {
    await createReportSchedule(user, clientId, {
      reportType,
      frequency,
      recipients,
      dayOfWeek: Number(formData.get("dayOfWeek") || 0),
      dayOfMonth: Number(formData.get("dayOfMonth") || 1),
      hour: Number(formData.get("hour") || 7),
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/reports");
  return { ok: true };
}

// App redesign (handoff README, Interactions & Behavior rule 2): "לכל
// פעולה הרסנית או קבוצתית יש ביטול: ... כיבוי חוק או תזמון." Converted from
// void-returning to plain result objects so ScheduleActions can show a
// toast and wire a real undo (calling this again with the previous value)
// instead of the silent fire-and-forget these used to be.
export async function toggleReportScheduleAction(
  scheduleId: string,
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await updateReportSchedule(user, scheduleId, { enabled });
  } catch (err) {
    return { ok: false, error: await friendlyError(err) };
  }
  revalidatePath("/app/reports");
  return { ok: true };
}

export async function deleteReportScheduleAction(scheduleId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await deleteReportSchedule(user, scheduleId);
  } catch (err) {
    return { ok: false, error: await friendlyError(err) };
  }
  revalidatePath("/app/reports");
  return { ok: true };
}

export async function sendReportScheduleNowAction(scheduleId: string): Promise<{ ok: boolean; reason?: string }> {
  const user = await requireUser();
  const result = await sendReportScheduleNow(user, scheduleId);
  return { ok: result.sent, reason: result.reason };
}
