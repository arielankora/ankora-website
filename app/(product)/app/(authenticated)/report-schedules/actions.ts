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

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
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
  if (!clientId) return { error: "יש לבחור לקוח." };

  const reportType = String(formData.get("reportType") || "MONTHLY_DETAILED") as ClientReportType;
  const frequency = String(formData.get("frequency") || "MONTHLY") as ReportFrequency;
  const recipients = parseEmailList(formData.get("recipients"));
  if (recipients.length === 0) return { error: "יש להזין לפחות נמען אחד." };

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
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/report-schedules");
  return { ok: true };
}

export async function toggleReportScheduleAction(scheduleId: string, enabled: boolean): Promise<void> {
  const user = await requireUser();
  await updateReportSchedule(user, scheduleId, { enabled });
  revalidatePath("/app/report-schedules");
}

export async function deleteReportScheduleAction(scheduleId: string): Promise<void> {
  const user = await requireUser();
  await deleteReportSchedule(user, scheduleId);
  revalidatePath("/app/report-schedules");
}

export async function sendReportScheduleNowAction(scheduleId: string): Promise<{ ok: boolean; reason?: string }> {
  const user = await requireUser();
  const result = await sendReportScheduleNow(user, scheduleId);
  return { ok: result.sent, reason: result.reason };
}
