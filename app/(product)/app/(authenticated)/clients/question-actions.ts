"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { askClientAbout, checkQuestionOurselves, createQuestionsTask, dismissQuestion, markQuestionsAsked, snoozeQuestion } from "@/lib/app-domain/client-questions";

// "שאלות ללקוח" on the client's page (1.11.2026, lib/client-questions.ts).
// Every button goes through the domain function, with its checks and its
// audit row.

type Result = { error?: string; ok?: boolean; taskId?: string };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

async function run(clientId: string, fn: () => Promise<unknown>, tasks = false): Promise<Result> {
  try {
    const r = await fn();
    revalidatePath(`/app/clients/${clientId}`);
    if (tasks) revalidatePath("/app/tasks");
    const taskId = (r as { taskId?: string } | null)?.taskId;
    return taskId ? { ok: true, taskId } : { ok: true };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/// The questions went to the client, by a message the person sent.
export async function markQuestionsAskedAction(clientId: string, itemIds: string[]): Promise<Result> {
  const user = await requireUser();
  return run(clientId, () => markQuestionsAsked(user, clientId, itemIds));
}

/// A task to send the message, with the message in it.
export async function createQuestionsTaskAction(clientId: string, itemIds: string[], draft: string, contactName: string | null): Promise<Result> {
  const user = await requireUser();
  return run(clientId, () => createQuestionsTask(user, clientId, itemIds, draft, contactName), true);
}

export async function askClientAboutAction(clientId: string, itemIds: string[]): Promise<Result> {
  const user = await requireUser();
  return run(clientId, () => askClientAbout(user, clientId, itemIds));
}

export async function dismissQuestionAction(clientId: string, itemId: string, reason: string): Promise<Result> {
  const user = await requireUser();
  return run(clientId, () => dismissQuestion(user, clientId, itemId, reason));
}

export async function checkQuestionOurselvesAction(clientId: string, itemId: string): Promise<Result> {
  const user = await requireUser();
  return run(clientId, () => checkQuestionOurselves(user, clientId, itemId), true);
}

/// `until` as the date input gives it, "2026-11-20": the line comes back
/// that morning, Israel time.
export async function snoozeQuestionAction(clientId: string, itemId: string, until: string): Promise<Result> {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: "צריך לבחור תאריך." };
  return run(clientId, () => snoozeQuestion(user, clientId, [itemId], new Date(`${until}T06:00:00Z`)));
}
