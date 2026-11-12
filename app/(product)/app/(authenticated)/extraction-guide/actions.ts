"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getTranslations } from "next-intl/server";
import { approveGuide, proposeGuide, rejectGuide } from "@/lib/app-domain/extraction-guide";
import { domainErrorText } from "@/lib/i18n/domain-errors";

// Org brain, decision 3: propose, approve and reject versions of the
// extraction guidance.

type FormState = { error?: string; ok?: boolean };

async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("extractionGuide.errors");
  if (err instanceof ForbiddenError) return t("forbidden");
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return t("generic");
}

async function run(fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath("/app/extraction-guide");
  return { ok: true };
}

export async function proposeGuideAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => proposeGuide(user, { body: String(formData.get("body") ?? ""), note: String(formData.get("note") ?? "") }));
}

export async function approveGuideAction(id: string): Promise<FormState> {
  const user = await requireUser();
  return run(() => approveGuide(user, id));
}

export async function rejectGuideAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => rejectGuide(user, String(formData.get("id") ?? ""), String(formData.get("reason") ?? "")));
}
