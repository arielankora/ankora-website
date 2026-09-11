"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { createCategory, updateCategory, archiveCategory } from "@/lib/app-domain/categories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import type { CategoryVisibility } from "@prisma/client";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

export async function createCategoryAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "יש להזין שם קטגוריה." };

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
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/categories");
  return { ok: true };
}

export async function updateCategoryAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const categoryId = String(formData.get("categoryId") || "");
  if (!categoryId) return { error: "קטגוריה לא נמצאה." };

  try {
    await updateCategory(user, categoryId, {
      name: String(formData.get("name") || "").trim(),
      description: String(formData.get("description") || ""),
      active: formData.get("active") === "on",
      sortOrder: Number(formData.get("sortOrder") || 0),
    });
  } catch (err) {
    return { error: friendlyError(err) };
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
