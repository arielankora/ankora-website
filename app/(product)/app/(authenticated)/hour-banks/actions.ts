"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { upsertBillingPolicy } from "@/lib/app-domain/billing";
import { openHourBankCycle, recordHourBankAdjustment } from "@/lib/app-domain/hour-banks";
import type { RoundingMode, BillingAggregationScope, RolloverMode } from "@prisma/client";
import { parseHoursInput } from "@/lib/hours-input";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function parseDateInput(value: FormDataEntryValue | null): Date | null {
  if (!value) return null;
  const d = new Date(`${String(value)}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

export async function upsertBillingPolicyAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: "יש לבחור לקוח." };

  try {
    await upsertBillingPolicy(user, clientId, {
      minimumMinutes: Number(formData.get("minimumMinutes") || 0),
      incrementMinutes: Number(formData.get("incrementMinutes") || 1),
      roundingMode: String(formData.get("roundingMode") || "EXACT") as RoundingMode,
      aggregationScope: String(formData.get("aggregationScope") || "PER_ENTRY") as BillingAggregationScope,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/hour-banks");
  return { ok: true };
}

export async function openHourBankCycleAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: "יש לבחור לקוח." };

  const cycleStart = parseDateInput(formData.get("cycleStart"));
  const cycleEnd = parseDateInput(formData.get("cycleEnd"));
  if (!cycleStart || !cycleEnd) return { error: "יש להזין תאריך התחלה ותאריך סיום תקינים." };

  // The form speaks hours; the domain keeps minutes. See lib/hours-input.ts.
  const purchasedMinutes = parseHoursInput(formData.get("purchasedHours"));
  if (purchasedMinutes === null) return { error: "יש להזין שעות שנרכשו, למשל 111 או 98:30." };
  const rolloverMode = String(formData.get("rolloverMode") || "NONE") as RolloverMode;
  const capRaw = String(formData.get("rolloverCapHours") || "").trim();
  const rolloverCapMinutes = capRaw ? parseHoursInput(capRaw) : undefined;
  if (rolloverCapMinutes === null) return { error: "תקרת ה-Rollover אינה מספר שעות תקין." };
  const manualRaw = String(formData.get("manualRolloverInHours") || "").trim();
  const manualRolloverInMinutes = manualRaw ? parseHoursInput(manualRaw) : undefined;
  if (manualRolloverInMinutes === null) return { error: "ה-Rollover הידני אינו מספר שעות תקין." };

  try {
    await openHourBankCycle(user, clientId, {
      cycleStart,
      cycleEnd,
      purchasedMinutes,
      rolloverMode,
      rolloverCapMinutes,
      manualRolloverInMinutes,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/hour-banks");
  return { ok: true };
}

export async function recordAdjustmentAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  const reason = String(formData.get("reason") || "").trim();
  const minutes = parseHoursInput(formData.get("hours"), { allowNegative: true });
  if (!clientId) return { error: "יש לבחור לקוח." };
  if (!reason) return { error: "יש להזין סיבה להתאמה." };
  if (!minutes) return { error: "יש להזין שעות שונות מאפס, למשל 2, 1:30 או -0:45." };

  try {
    await recordHourBankAdjustment(user, clientId, {
      hourBankId: (formData.get("hourBankId") as string) || undefined,
      minutes,
      reason,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/hour-banks");
  return { ok: true };
}
