import "server-only";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import type { User, TaskStatus } from "@prisma/client";

// Phase 9 gap-fix (docs/adr/0001 section 17.2): spec section 11's
// dedicated "Tasks" screen - open/recent tasks, filterable by client/
// category/status - never existed; a Task previously only ever came into
// being (in theory - Phase 2's actual UI never even wired the picker) as
// an inline create-or-pick inside the timer/manual-entry forms. This file
// is the first real domain logic for standalone Task CRUD.
//
// Scoping follows the exact precedent set by lib/app-domain/time-entries.ts
// and the timer/manual-entry client picker: no dedicated task.* permission
// exists (none was added to permissions.ts - see that file's Phase 9
// comment) because "can this user see/act on this task" reduces entirely
// to "can this user see/act on this task's client," which
// listAccessibleClients() (spec 4.1: "אסור לעובד לדווח זמן ללקוח שאינו
// משויך אליו") already answers for the timer/reports screens. An admin
// (canManageClients) sees/creates tasks for every active client; anyone
// else only for clients they hold a UserClientAccess row for.

export async function listTasks(
  actor: User,
  filters: { clientId?: string; categoryId?: string; status?: TaskStatus } = {}
) {
  const accessible = await listAccessibleClients(actor);
  const accessibleIds = accessible.map((c) => c.id);
  if (accessibleIds.length === 0) return [];

  const clientId = filters.clientId && accessibleIds.includes(filters.clientId) ? filters.clientId : undefined;

  return prisma.task.findMany({
    where: {
      deletedAt: null,
      clientId: clientId ?? { in: accessibleIds },
      categoryId: filters.categoryId || undefined,
      status: filters.status || undefined,
    },
    include: { client: true, category: true },
    // Open/In-progress first (spec §11: "open/recent tasks"), newest first
    // within each status.
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function createTask(
  actor: User,
  input: { clientId: string; categoryId?: string | null; title: string }
) {
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === input.clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }
  const title = input.title.trim();
  if (!title) throw new Error("Task title is required.");

  const task = await prisma.task.create({
    data: {
      clientId: input.clientId,
      categoryId: input.categoryId || null,
      title,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "task.create",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: task,
  });
  return task;
}

export async function updateTaskStatus(actor: User, taskId: string, status: TaskStatus) {
  const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null } });
  if (!task) throw new Error("Task not found.");

  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === task.clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }

  const updated = await prisma.task.update({ where: { id: taskId }, data: { status } });
  await recordAudit({
    actorId: actor.id,
    action: "task.status_change",
    entityType: "Task",
    entityId: taskId,
    clientId: task.clientId,
    before: task,
    after: updated,
  });
  return updated;
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "פתוחה",
  IN_PROGRESS: "בביצוע",
  DONE: "הושלמה",
  ARCHIVED: "בארכיון",
};
