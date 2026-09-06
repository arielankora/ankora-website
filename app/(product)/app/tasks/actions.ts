"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { createTask, updateTaskStatus } from "@/lib/app-domain/tasks";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import type { TaskStatus } from "@prisma/client";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

export async function createTaskAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  const title = String(formData.get("title") || "").trim();
  if (!clientId) return { error: "יש לבחור לקוח." };
  if (!title) return { error: "יש להזין שם משימה." };

  try {
    await createTask(user, {
      clientId,
      categoryId: String(formData.get("categoryId") || "") || null,
      title,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/tasks");
  return { ok: true };
}

export async function updateTaskStatusAction(formData: FormData) {
  const user = await requireUser();
  const taskId = String(formData.get("taskId") || "");
  const status = String(formData.get("status") || "") as TaskStatus;
  if (!taskId || !status) return;

  await updateTaskStatus(user, taskId, status);
  revalidatePath("/app/tasks");
}
