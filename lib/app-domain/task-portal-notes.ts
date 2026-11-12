import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, assertCan, can } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { DomainError } from "@/lib/domain-error";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { checkPortalNote, MAX_PORTAL_NOTE_LENGTH } from "@/lib/task-portal-note-text";

// Lines the client reads under a visible task on their portal (4.11.2026).
// See TaskPortalNote in prisma/schema.prisma for why this is not a comment.
//
// Every write checks the same three things: the person may work on the
// task's client, the task is still visible to that client, and the line is
// short and plain. A note on a task the client cannot see would be a line
// nobody reads, and making the task visible later would publish it without
// anyone having decided to.

async function taskForNote(actor: User, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: { id: true, clientId: true, clientVisible: true, status: true },
  });
  if (!task) throw new DomainError("taskPortalNotes.taskNotFound", "המשימה לא נמצאה.");
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === task.clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }
  return task;
}

export async function addTaskPortalNote(actor: User, taskId: string, body: string) {
  assertCan(actor.role, "time_entry.create_self");
  const checked = checkPortalNote(body);
  if (!checked.ok) {
    if (!String(body ?? "").trim()) throw new DomainError("taskPortalNotes.empty", checked.error);
    throw new DomainError("taskPortalNotes.tooLong", checked.error, { max: String(MAX_PORTAL_NOTE_LENGTH) });
  }

  const task = await taskForNote(actor, taskId);
  if (!task.clientVisible) {
    throw new DomainError("taskPortalNotes.taskNotVisible", "המשימה לא מוצגת ללקוח, ולכן אין לאן להוסיף שורה. אפשר להציג אותה בפורטל ואז להוסיף.");
  }
  if (task.status === "ARCHIVED") throw new DomainError("taskPortalNotes.taskArchived", "המשימה בארכיון.");

  const note = await prisma.taskPortalNote.create({
    data: { taskId: task.id, body: checked.text, createdById: actor.id },
  });
  await recordAudit({
    actorId: actor.id,
    action: "task.portal_note_add",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: { noteId: note.id, body: note.body },
  });
  return note;
}

/// Take a line off the portal. The writer, or anyone who already edits
/// other people's work, the same rule as removing a comment.
export async function removeTaskPortalNote(actor: User, noteId: string) {
  assertCan(actor.role, "time_entry.create_self");
  const note = await prisma.taskPortalNote.findFirst({
    where: { id: noteId, deletedAt: null },
    select: { id: true, taskId: true, body: true, createdById: true },
  });
  if (!note) throw new DomainError("taskPortalNotes.noteNotFound", "השורה לא נמצאה.");
  const task = await taskForNote(actor, note.taskId);
  if (note.createdById !== actor.id && !can(actor.role, "time_entry.edit_others")) {
    throw new ForbiddenError("אפשר להסיר רק שורות שכתבתם.");
  }

  await prisma.taskPortalNote.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "task.portal_note_remove",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    before: { noteId: note.id, body: note.body },
  });
}

/// The task screen's list, oldest first, as the client reads it.
export async function listTaskPortalNotes(actor: User, taskId: string) {
  await taskForNote(actor, taskId);
  return prisma.taskPortalNote.findMany({
    where: { taskId, deletedAt: null },
    select: { id: true, body: true, createdAt: true, createdById: true },
    orderBy: { createdAt: "asc" },
  });
}
