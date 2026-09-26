"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { assignableUsers, createTask, updateTask } from "@/lib/app-domain/tasks";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import type { SupplierExperience, TaskBlocker, TaskPriority, TaskStatus } from "@prisma/client";

type FormState = { error?: string; ok?: boolean; created?: CreatedTaskRow };

/// The row the list needs, returned by the action that wrote it.
///
/// This is the whole point of the change it belongs to. Until now a
/// created task reached the screen only by the screen going back to the
/// server for it, and that round trip has been cancelled on and off for
/// three weeks across five investigations. A row that comes back with
/// the write cannot be cancelled, cannot be raced and cannot arrive
/// late: it is already here.
///
/// Shaped for the row component rather than returned whole. A Server
/// Action's return value crosses the wire, so it carries what the screen
/// draws and nothing else - not the audit trail, not the supervisor, not
/// fields the list has never shown.
export type CreatedTaskRow = {
  id: string;
  title: string;
  clientName: string;
  categoryName: string | null;
  dueDate: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /// Set on a create when the form named someone (26.9.2026: the create
  /// form gained an assignee and a supervisor picker). The id travels with
  /// the name so the list can tell whether a new task belongs under "שלי".
  assignedToId: string | null;
  assignedToName: string | null;
  /// Shown on every row since 26.9.2026, beside the assignee: who signs
  /// for the work is as much a part of "whose is this" as who does it.
  supervisorName: string | null;
  clientVisible: boolean;
  supplierName: string | null;
  supplierExperience: SupplierExperience | null;
  clientTitle: string | null;
  /// Tasks phase 5. Both null on a create: a task is not born waiting.
  blockedOn: TaskBlocker | null;
  blockedSince: string | null;
  clientOutcome: string | null;
  /// Tasks phase 5. Both zero on a create, because a task is born
  /// without steps, and carried anyway for the same reason
  /// `assignedToName` is: one shape, not a near-miss of one.
  stepsTotal: number;
  stepsDone: number;
};

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
  const assignedToId = String(formData.get("assignedToId") || "") || null;
  const supervisorId = String(formData.get("supervisorId") || "") || null;

  let created;
  try {
    created = await createTask(user, {
      clientId,
      categoryId: String(formData.get("categoryId") || "") || null,
      title,
      // Portal phase 1: opting a task in at creation is the cheapest
      // moment to do it, and the only one where the person already has
      // the client's words in their head.
      clientVisible: formData.get("clientVisible") === "on",
      clientTitle: String(formData.get("clientTitle") || "") || null,
      // Checked by createTask against the same list the form offered
      // (assignableUsers), so a stale or forged id is refused there.
      assignedToId,
      supervisorId,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  // The two names the row shows and the row itself does not carry. Read
  // after the write rather than taken from the form, because the form
  // holds ids and the screen shows names, and a name the browser sent is
  // a name the browser could have been wrong about.
  const peopleIds = [created.assignedToId, created.supervisorId].filter((id): id is string => Boolean(id));
  const [client, category, people] = await Promise.all([
    prisma.client.findUnique({ where: { id: created.clientId }, select: { name: true } }),
    created.categoryId
      ? prisma.category.findUnique({ where: { id: created.categoryId }, select: { name: true } })
      : Promise.resolve(null),
    peopleIds.length
      ? prisma.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);

  // Still revalidated. The returned row is what the person sees now; this
  // is what every OTHER open tab, and this one on its next navigation,
  // sees. Dropping it would trade one stale screen for another.
  revalidatePath("/app/tasks");
  // The client screen lists the same client's open tasks and opens this
  // same form, so a task created there should be on it without a reload.
  revalidatePath(`/app/clients/${created.clientId}`);

  return {
    ok: true,
    created: {
      id: created.id,
      title: created.title,
      clientName: client?.name ?? "",
      categoryName: category?.name ?? null,
      dueDate: created.dueDate?.toISOString() ?? null,
      status: created.status,
      priority: created.priority,
      assignedToId: created.assignedToId,
      assignedToName: nameOf(created.assignedToId),
      supervisorName: nameOf(created.supervisorId),
      clientVisible: created.clientVisible,
      supplierName: created.supplierName,
      supplierExperience: created.supplierExperience,
      clientTitle: created.clientTitle,
      blockedOn: created.blockedOn,
      blockedSince: created.blockedSince?.toISOString() ?? null,
      clientOutcome: created.clientOutcome,
      // A task is born without steps. Stated rather than inferred, so
      // this object stays a complete CreatedTaskRow and the compiler
      // keeps saying so when the shape grows again.
      stepsTotal: 0,
      stepsDone: 0,
    },
  };
}

// App redesign (handoff README, screen 4 "משימות"): "תיבת סימון... סימון
// כהושלם -> טוסט עם ביטול." A plain async function (not a <form action>)
// so TaskRow can read back the resulting status and use the *previous*
// one as a real undo action, matching the same call-and-await pattern
// app/timer/TimerWidget.tsx uses for start/stop. Also backs the row's
// status tag (any of the four TaskStatus values), replacing the old
// standalone TaskStatusSelect - one status-change path for the whole row
// instead of two independently-wired controls.
//
// Team adoption: `clientOutcome` rides along on the close. A client-visible
// task is refused DONE without one (updateTask's assertClosable), so the
// row asks for the sentence and sends it in the same call - rather than
// closing the task and then hoping somebody comes back to explain it.
/// The people a task on this client can be given to, for the create
/// form's assignee and supervisor pickers.
///
/// Asked per client, after the client is chosen, because the answer is
/// per client: assignableUsers returns only colleagues who can open this
/// client's tasks, the same list the task screen offers. Loading every
/// client's list up front would put the whole staff-to-client map in the
/// page for a form that uses one row of it.
export async function listAssignablePeopleAction(
  clientId: string
): Promise<{ ok: true; people: { id: string; name: string }[] } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!clientId) return { ok: true, people: [] };
  try {
    const people = await assignableUsers(user, clientId);
    return { ok: true, people: people.map((p) => ({ id: p.id, name: p.name })) };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

export async function toggleTaskDoneAction(input: {
  taskId: string;
  nextStatus: TaskStatus;
  clientOutcome?: string | null;
}) {
  const user = await requireUser();
  try {
    const updated = await updateTask(user, input.taskId, {
      status: input.nextStatus,
      clientOutcome: input.clientOutcome,
    });
    revalidatePath("/app/tasks");
    revalidatePath("/app/portal");
    return { ok: true as const, status: updated.status, clientOutcome: updated.clientOutcome };
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
  // Portal phase 3: the supplier line, recorded at the moment the task
  // closes. See the schema comment on Task.supplierName for why it lives
  // on the task and not in a directory of its own.
  supplierName?: string | null;
  supplierExperience?: SupplierExperience | null;
  // Team adoption: the sentence the client reads when this is done. Kept
  // here alongside the other portal fields because it is one of them: it
  // is written in the client's language and it is what they see.
  clientOutcome?: string | null;
}) {
  const user = await requireUser();
  try {
    const updated = await updateTask(user, input.taskId, {
      clientOutcome: input.clientOutcome,
      clientVisible: input.clientVisible,
      clientTitle: input.clientTitle,
      // The row's toggle is one click and says one thing: the client is
      // what we are waiting on. Tasks phase 5 widened the field behind
      // it to four blockers and a reason, and this gesture deliberately
      // did not grow a form - see the schema comment on Task.blockedOn.
      // The task screen is where the other three live.
      block:
        input.waitingOnClient === undefined ? undefined : input.waitingOnClient ? { on: "CLIENT" } : null,
      supplierName: input.supplierName,
      supplierExperience: input.supplierExperience,
    });
    revalidatePath("/app/tasks");
    revalidatePath("/app/portal");
    return {
      ok: true as const,
      clientVisible: updated.clientVisible,
      clientTitle: updated.clientTitle,
      blockedOn: updated.blockedOn,
      blockedSince: updated.blockedSince?.toISOString() ?? null,
      supplierName: updated.supplierName,
      supplierExperience: updated.supplierExperience,
      clientOutcome: updated.clientOutcome,
    };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}
