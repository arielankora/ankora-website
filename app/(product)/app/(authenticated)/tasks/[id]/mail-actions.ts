"use server";
import { revalidatePath } from "next/cache";
import type { TaskBlocker } from "@prisma/client";
import { requireUser } from "@/lib/app-auth/session";
import { DomainError } from "@/lib/domain-error";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { followEmailReply, sendWaitReminder, setReminder, stopFollowing } from "@/lib/mail-scan/waits";
import { parseRemindAt } from "@/lib/mail-scan/wait-rules";

// Stage 2 of "התיבות שלי" (27.11.2026): the task screen's actions on a wait
// for an email reply (lib/mail-scan/waits.ts). Each answers ok, or the
// refusal in the reader's language.

export type MailActionResult = { ok: true } | { ok: false; error: string };

const BLOCKERS: TaskBlocker[] = ["CLIENT", "SUPPLIER", "INTERNAL", "OTHER"];

async function run(taskId: string, work: () => Promise<unknown>): Promise<MailActionResult> {
  try {
    await work();
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: (await domainErrorText(err)) ?? err.message };
    throw err;
  }
  revalidatePath(`/app/tasks/${taskId}`);
  return { ok: true };
}

export async function followMailAction(input: { taskId: string; threadId: string; on: TaskBlocker; reason: string | null; remindAt: string | null }): Promise<MailActionResult> {
  const user = await requireUser();
  const on = BLOCKERS.includes(input.on) ? input.on : "OTHER";
  const remindAt = input.remindAt ? parseRemindAt(input.remindAt) : null;
  return run(input.taskId, () =>
    followEmailReply(user, { taskId: input.taskId, threadId: input.threadId, waitingOn: on, reason: input.reason, remindAt, via: "MANUAL" }),
  );
}

export async function stopMailAction(input: { taskId: string; unblock: boolean }): Promise<MailActionResult> {
  const user = await requireUser();
  return run(input.taskId, () => stopFollowing(user, input.taskId, { unblock: input.unblock }));
}

export async function rescheduleMailAction(input: { taskId: string; remindAt: string }): Promise<MailActionResult> {
  const user = await requireUser();
  const at = parseRemindAt(input.remindAt);
  return run(input.taskId, async () => {
    if (!at) throw new DomainError("mailWaits.badDate", "המועד צריך להיות תאריך ושעה בעתיד.");
    await setReminder(user, input.taskId, at);
  });
}

export async function sendReminderAction(input: { taskId: string; text: string; nextRemindAt: string | null }): Promise<MailActionResult> {
  const user = await requireUser();
  const next = input.nextRemindAt ? parseRemindAt(input.nextRemindAt) : undefined;
  return run(input.taskId, () => sendWaitReminder(user, input.taskId, { text: input.text, nextRemindAt: next }));
}
