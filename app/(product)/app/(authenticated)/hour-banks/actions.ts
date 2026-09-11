"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { upsertBillingPolicy } from "@/lib/app-domain/billing";
import { openHourBankCycle, recordHourBankAdjustment } from "@/lib/app-domain/hour-banks";
import type { RoundingMode, BillingAggregationScope, RolloverMode } from "@prisma/client";

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

  const purchasedMinutes = Number(formData.get("purchasedMinutes") || 0);
  const rolloverMode = String(formData.get("rolloverMode") || "NONE") as RolloverMode;
  const rolloverCapMinutesRaw = formData.get("rolloverCapMinutes");
  const manualRolloverRaw = formData.get("manualRolloverInMinutes");

  try {
    await openHourBankCycle(user, clientId, {
      cycleStart,
      cycleEnd,
      purchasedMinutes,
      rolloverMode,
      rolloverCapMinutes: rolloverCapMinutesRaw ? Number(rolloverCapMinutesRaw) : undefined,
      manualRolloverInMinutes: manualRolloverRaw ? Number(manualRolloverRaw) : undefined,
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
  const minutes = Number(formData.get("minutes") || 0);
  if (!clientId) return { error: "יש לבחור לקוח." };
  if (!reason) return { error: "יש להזין סיבה להתאמה." };
  if (!minutes) return { error: "יש להזין מספר דקות שונה מאפס." };

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
