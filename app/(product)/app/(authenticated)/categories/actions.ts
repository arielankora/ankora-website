"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { createCategory, updateCategory, archiveCategory } from "@/lib/app-domain/categories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import type { CategoryVisibility } from "@prisma/client";

type FormState = { error?: string; ok?: boolean };

async function errorsT() {
  return getTranslations("categories.errors");
}

async function errorText(key: "nameRequired" | "notFound") {
  const t = await errorsT();
  return t(key);
}

async function friendlyError(err: unknown): Promise<string> {
  const t = await errorsT();
  if (err instanceof ForbiddenError) return t("forbidden");
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return t("generic");
}

export async function createCategoryAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: await errorText("nameRequired") };

  const visibility = String(formData.get("visibility") || "GLOBAL") as CategoryVisibility;
  const clientId = String(formData.get("clientId") || "") || null;

  try {
    await createCategory(user, {
      name,
      description: String(formData.get("description") || ""),
      visibility,
      clientId,
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/categories");
  return { ok: true };
}

export async function updateCategoryAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const categoryId = String(formData.get("categoryId") || "");
  if (!categoryId) return { error: await errorText("notFound") };

  try {
    await updateCategory(user, categoryId, {
      name: String(formData.get("name") || "").trim(),
      description: String(formData.get("description") || ""),
      active: formData.get("active") === "on",
      sortOrder: Number(formData.get("sortOrder") || 0),
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/categories");
  revalidatePath(`/app/categories/${categoryId}`);
  return { ok: true };
}

export async function archiveCategoryAction(formData: FormData) {
  const user = await requireUser();
  const categoryId = String(formData.get("categoryId") || "");
  if (!categoryId) return;

  await archiveCategory(user, categoryId);
  revalidatePath("/app/categories");
}
