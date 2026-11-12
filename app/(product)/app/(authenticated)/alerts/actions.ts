"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  retryEmailDelivery,
  resolveAlertEvent,
  unresolveAlertEvent,
} from "@/lib/app-domain/alerts";
import type { AlertThresholdType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";

type FormState = { error?: string; ok?: boolean };

/// ADR 0006: in the reader's language.
async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("alerts.errors");
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

export async function createAlertRuleAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: (await getTranslations("alerts.errors"))("pickClient") };

  const type = String(formData.get("type") || "UTILIZATION_PCT") as AlertThresholdType;
  const thresholdValue = Number(formData.get("thresholdValue") || 0);
  const recipientsAnkora = parseEmailList(formData.get("recipientsAnkora"));
  const recipientsClient = parseEmailList(formData.get("recipientsClient"));

  if (recipientsAnkora.length === 0 && recipientsClient.length === 0) {
    return { error: (await getTranslations("alerts.errors"))("recipientsRequired") };
  }

  try {
    await createAlertRule(user, clientId, {
      type,
      thresholdValue,
      recipientsAnkora,
      recipientsClient,
      allowRetrigger: formData.get("allowRetrigger") === "on",
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/alerts");
  return { ok: true };
}

// App redesign (handoff README, Interactions & Behavior rule 2): "לכל
// פעולה הרסנית או קבוצתית יש ביטול: ... כיבוי חוק." Converted from
// void-returning to result objects, same reasoning as report-schedules/
// actions.ts's toggleReportScheduleAction, so RuleActions can show a real
// toast with undo instead of firing silently.
export async function toggleAlertRuleAction(ruleId: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await updateAlertRule(user, ruleId, { enabled });
  } catch (err) {
    return { ok: false, error: await friendlyError(err) };
  }
  revalidatePath("/app/alerts");
  return { ok: true };
}

export async function deleteAlertRuleAction(ruleId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await deleteAlertRule(user, ruleId);
  } catch (err) {
    return { ok: false, error: await friendlyError(err) };
  }
  revalidatePath("/app/alerts");
  return { ok: true };
}

// App redesign: surfaces the real outcome (rule 5: "כשלון אמיתי נשאר
// כשלון") instead of the previous silent void return - retryEmailDelivery
// itself still marks the delivery FAILED again if the resend genuinely
// fails, this just lets the button show that instead of pretending success.
export async function retryEmailDeliveryAction(deliveryId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    const updated = await retryEmailDelivery(user, deliveryId);
    revalidatePath("/app/alerts");
    if (updated.status === "SENT") return { ok: true };
    // The provider's own error text is passed on as it is.
    return { ok: false, error: updated.error ?? (await getTranslations("alerts.errors"))("sendFailedAgain") };
  } catch (err) {
    return { ok: false, error: await friendlyError(err) };
  }
}

// App redesign (handoff README, screen 13 "התראות"): "כרטיסי התראה פתוחה
// עם פעולה ישירה: סימון כטופל (עם ביטול)." See resolveAlertEvent's comment
// in lib/app-domain/alerts.ts for why a manual resolve is safe alongside
// the automatic evaluation that already closes these events.
export async function resolveAlertEventAction(eventId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await resolveAlertEvent(user, eventId);
  } catch (err) {
    return { ok: false, error: await friendlyError(err) };
  }
  revalidatePath("/app/alerts");
  return { ok: true };
}

export async function unresolveAlertEventAction(eventId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await unresolveAlertEvent(user, eventId);
  } catch (err) {
    return { ok: false, error: await friendlyError(err) };
  }
  revalidatePath("/app/alerts");
  return { ok: true };
}
