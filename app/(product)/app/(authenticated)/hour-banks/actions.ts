"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { upsertBillingPolicy } from "@/lib/app-domain/billing";
import {
  openHourBankCycle,
  recordHourBankAdjustment,
  loadPrepaidPackage,
  previewPrepaidLoad,
} from "@/lib/app-domain/hour-banks";
import { can } from "@/lib/app-auth/permissions";
import { dayStartInZone } from "@/lib/timezone";
import type { RoundingMode, BillingAggregationScope, RolloverMode } from "@prisma/client";
import { parseHoursInput } from "@/lib/hours-input";
import { RunningTimersOnClientError } from "@/lib/app-domain/closed-bank-guard";
import { getFormatter, getTranslations } from "next-intl/server";
import type messages from "@/messages/he.json";
import { domainErrorText, domainText } from "@/lib/i18n/domain-errors";

type FormState = { error?: string; ok?: boolean };

/// ADR 0006: in the reader's language. A running-timers refusal names
/// each timer's start in the reader's time zone, not the Hebrew list the
/// domain's message carries.
async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("hourBanks.errors");
  if (err instanceof ForbiddenError) return t("forbidden");
  if (err instanceof RunningTimersOnClientError) {
    const format = await getFormatter();
    const timers = err.timers
      .map((timer) =>
        t("runningTimer", {
          name: timer.employeeName,
          start: format.dateTime(timer.startAt, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }),
        })
      )
      .join(", ");
    return domainText(`domainErrors.${err.code}`, { timers });
  }
  const text = await domainErrorText(err);
  if (text) return text;
  if (err instanceof Error) return err.message;
  return t("generic");
}

async function errorText(key: keyof (typeof messages)["hourBanks"]["errors"]): Promise<string> {
  const t = await getTranslations("hourBanks.errors");
  return t(key);
}

function parseDateInput(value: FormDataEntryValue | null): Date | null {
  if (!value) return null;
  const d = new Date(`${String(value)}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

export async function upsertBillingPolicyAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: await errorText("pickClient") };

  try {
    await upsertBillingPolicy(user, clientId, {
      minimumMinutes: Number(formData.get("minimumMinutes") || 0),
      incrementMinutes: Number(formData.get("incrementMinutes") || 1),
      roundingMode: String(formData.get("roundingMode") || "EXACT") as RoundingMode,
      aggregationScope: String(formData.get("aggregationScope") || "PER_ENTRY") as BillingAggregationScope,
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/hour-banks");
  return { ok: true };
}

export async function openHourBankCycleAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: await errorText("pickClient") };

  const cycleStart = parseDateInput(formData.get("cycleStart"));
  const cycleEnd = parseDateInput(formData.get("cycleEnd"));
  if (!cycleStart || !cycleEnd) return { error: await errorText("cycleDates") };

  // The form speaks hours; the domain keeps minutes. See lib/hours-input.ts.
  const purchasedMinutes = parseHoursInput(formData.get("purchasedHours"));
  if (purchasedMinutes === null) return { error: await errorText("cycleHours") };
  const rolloverMode = String(formData.get("rolloverMode") || "NONE") as RolloverMode;
  const capRaw = String(formData.get("rolloverCapHours") || "").trim();
  const rolloverCapMinutes = capRaw ? parseHoursInput(capRaw) : undefined;
  if (rolloverCapMinutes === null) return { error: await errorText("capInvalid") };
  const manualRaw = String(formData.get("manualRolloverInHours") || "").trim();
  const manualRolloverInMinutes = manualRaw ? parseHoursInput(manualRaw) : undefined;
  if (manualRolloverInMinutes === null) return { error: await errorText("manualRolloverInvalid") };

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
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/hour-banks");
  return { ok: true };
}

export async function recordAdjustmentAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  const reason = String(formData.get("reason") || "").trim();
  const minutes = parseHoursInput(formData.get("hours"), { allowNegative: true });
  if (!clientId) return { error: await errorText("pickClient") };
  if (!reason) return { error: await errorText("adjustmentReason") };
  if (!minutes) return { error: await errorText("adjustmentHours") };

  try {
    await recordHourBankAdjustment(user, clientId, {
      hourBankId: (formData.get("hourBankId") as string) || undefined,
      minutes,
      reason,
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/hour-banks");
  return { ok: true };
}

/// A purchase date is an Israeli day: the package starts at midnight
/// Israel time on that day. Today means now, so the hours logged earlier
/// today stay with the package they were logged against.
function purchaseInstant(value: FormDataEntryValue | null): Date | null {
  const start = dayStartInZone(value ? String(value) : null);
  if (!start) return null;
  const now = new Date();
  return start.getTime() <= now.getTime() && now.getTime() - start.getTime() < 86_400_000 ? now : start;
}

export type LoadPreviewState = {
  error?: string;
  previous?: { kind: "CYCLE" | "PREPAID"; balanceMinutes: number; stillValid: boolean } | null;
  carryInMinutes?: number;
};

export async function previewPrepaidLoadAction(clientId: string, purchaseDate: string): Promise<LoadPreviewState> {
  const user = await requireUser();
  if (!can(user.role, "hour_bank.manage")) return { error: await errorText("forbidden") };
  const startAt = purchaseInstant(purchaseDate);
  if (!startAt) return { error: await errorText("pickPurchaseDate") };
  try {
    const preview = await previewPrepaidLoad(clientId, startAt);
    return {
      previous: preview.previous && {
        kind: preview.previous.kind,
        balanceMinutes: preview.previous.balanceMinutes,
        stillValid: preview.previous.stillValid,
      },
      carryInMinutes: preview.carryInMinutes,
    };
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}

export async function loadPrepaidPackageAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: await errorText("pickClient") };

  const startAt = purchaseInstant(formData.get("purchaseDate"));
  if (!startAt) return { error: await errorText("purchaseDateInvalid") };
  const purchasedMinutes = parseHoursInput(formData.get("purchasedHours"));
  if (!purchasedMinutes) return { error: await errorText("packageHours") };
  const expiresRaw = String(formData.get("expiresAt") || "").trim();
  const expiresAt = expiresRaw ? dayStartInZone(expiresRaw) : undefined;
  if (expiresRaw && !expiresAt) return { error: await errorText("expiresInvalid") };

  try {
    await loadPrepaidPackage(user, clientId, {
      startAt,
      purchasedMinutes,
      expiresAt,
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/hour-banks");
  revalidatePath("/app");
  return { ok: true };
}
