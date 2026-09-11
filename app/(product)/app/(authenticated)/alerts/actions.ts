"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  retryEmailDelivery,
} from "@/lib/app-domain/alerts";
import type { AlertThresholdType } from "@prisma/client";

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

export async function createAlertRuleAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: "יש לבחור לקוח." };

  const type = String(formData.get("type") || "UTILIZATION_PCT") as AlertThresholdType;
  const thresholdValue = Number(formData.get("thresholdValue") || 0);
  const recipientsAnkora = parseEmailList(formData.get("recipientsAnkora"));
  const recipientsClient = parseEmailList(formData.get("recipientsClient"));

  if (recipientsAnkora.length === 0 && recipientsClient.length === 0) {
    return { error: "יש להזין לפחות נמען אחד (Ankora ו/או לקוח)." };
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
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/alerts");
  return { ok: true };
}

export async function toggleAlertRuleAction(ruleId: string, enabled: boolean): Promise<void> {
  const user = await requireUser();
  await updateAlertRule(user, ruleId, { enabled });
  revalidatePath("/app/alerts");
}

export async function deleteAlertRuleAction(ruleId: string): Promise<void> {
  const user = await requireUser();
  await deleteAlertRule(user, ruleId);
  revalidatePath("/app/alerts");
}

export async function retryEmailDeliveryAction(deliveryId: string): Promise<void> {
  const user = await requireUser();
  await retryEmailDelivery(user, deliveryId);
  revalidatePath("/app/alerts");
}
