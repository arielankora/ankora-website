"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { createTask, updateTask, updateTaskStatus } from "@/lib/app-domain/tasks";
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
      // Portal phase 1: opting a task in at creation is the cheapest
      // moment to do it, and the only one where the person already has
      // the client's words in their head.
      clientVisible: formData.get("clientVisible") === "on",
      clientTitle: String(formData.get("clientTitle") || "") || null,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/tasks");
  return { ok: true };
}

// App redesign (handoff README, screen 4 "משימות"): "תיבת סימון... סימון
// כהושלם -> טוסט עם ביטול." A plain async function (not a <form action>)
// so TaskRow can read back the resulting status and use the *previous*
// one as a real undo action, matching the same call-and-await pattern
// app/timer/TimerWidget.tsx uses for start/stop. Also backs the row's
// status tag (any of the four TaskStatus values), replacing the old
// standalone TaskStatusSelect - one status-change path for the whole row
// instead of two independently-wired controls.
export async function toggleTaskDoneAction(input: { taskId: string; nextStatus: TaskStatus }) {
  const user = await requireUser();
  try {
    const updated = await updateTaskStatus(user, input.taskId, input.nextStatus);
    revalidatePath("/app/tasks");
    return { ok: true as const, status: updated.status };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}

// Portal phase 1. The three portal fields a task carries, written from
// the row itself.
//
// One action rather than three: every one of them is "change how this
// task appears to its client", they are toggled in the same gesture, and
// updateTask() already takes a patch where an absent key means "leave it
// alone". Three actions would have been three identical permission
// checks and three revalidatePath calls.
//
// /app/portal is revalidated alongside /app/tasks, because these writes
// change what a client sees on a screen they may already have open.
export async function updateTaskPortalAction(input: {
  taskId: string;
  clientVisible?: boolean;
  clientTitle?: string | null;
  waitingOnClient?: boolean;
}) {
  const user = await requireUser();
  try {
    const updated = await updateTask(user, input.taskId, {
      clientVisible: input.clientVisible,
      clientTitle: input.clientTitle,
      // The row speaks in "is it waiting", the column stores "since
      // when" - the translation belongs here rather than in the browser,
      // so the timestamp is the server's and cannot be back-dated by a
      // caller.
      waitingOnClientSince:
        input.waitingOnClient === undefined ? undefined : input.waitingOnClient ? new Date() : null,
    });
    revalidatePath("/app/tasks");
    revalidatePath("/app/portal");
    return {
      ok: true as const,
      clientVisible: updated.clientVisible,
      clientTitle: updated.clientTitle,
      waitingOnClient: updated.waitingOnClientSince !== null,
    };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}
