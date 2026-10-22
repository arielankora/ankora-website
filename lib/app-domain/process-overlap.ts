import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { addTaskComment, updateTask } from "@/lib/app-domain/tasks";
import { coveredTasks, type Overlap } from "@/lib/process-task-overlap";

// Open tasks an approved process already covers (lib/process-task-overlap.ts).
// Shown on the process and in "אישורים"; closed only by a manager, one at a
// time, with a comment on the task that says which process took it over.

export type CoveredTask = {
  clientId: string;
  process: { id: string; code: string; title: string };
  task: { id: string; title: string; status: string; assignee: string | null; createdAt: Date };
  overlap: Overlap;
};

const OPEN = ["OPEN", "IN_PROGRESS"] as const;

async function readFor(clientIds: string[]): Promise<CoveredTask[]> {
  if (clientIds.length === 0) return [];
  const [processes, tasks] = await Promise.all([
    prisma.process.findMany({
      where: { clientId: { in: clientIds }, deletedAt: null, status: "ACTIVE" },
      select: { id: true, clientId: true, code: true, title: true, purpose: true, status: true },
      orderBy: { seq: "asc" },
    }),
    prisma.task.findMany({
      where: { clientId: { in: clientIds }, deletedAt: null, parentId: null, processId: null, status: { in: [...OPEN] } },
      select: { id: true, clientId: true, title: true, status: true, processId: true, parentId: true, createdAt: true, assignedTo: { select: { name: true } } },
    }),
  ]);
  const out: CoveredTask[] = [];
  for (const clientId of clientIds) {
    const ps = processes.filter((p) => p.clientId === clientId);
    const ts = tasks.filter((t) => t.clientId === clientId);
    for (const m of coveredTasks(ps, ts)) {
      const p = ps.find((x) => x.id === m.processId)!;
      const t = ts.find((x) => x.id === m.taskId)!;
      out.push({
        clientId,
        process: { id: p.id, code: p.code, title: p.title },
        task: { id: t.id, title: t.title, status: t.status, assignee: t.assignedTo?.name ?? null, createdAt: t.createdAt },
        overlap: m.overlap,
      });
    }
  }
  return out;
}

/// The client's open tasks that an approved process covers.
export async function coveredTasksForClient(actor: User, clientId: string): Promise<CoveredTask[]> {
  await assertClientAccess(actor, clientId);
  return readFor([clientId]);
}

/// The same, across clients, for "אישורים". The caller has already scoped
/// the clients to the person.
export async function coveredTasksForClients(clientIds: string[]): Promise<CoveredTask[]> {
  return readFor(clientIds);
}

/// "לסגור, התהליך מכסה את זה": the task goes to the archive, with a
/// comment that names the process, and the decision is in the audit log.
export async function closeTaskCoveredByProcess(actor: User, taskId: string, processId: string) {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל סוגר משימה בגלל שתהליך מכסה אותה.");
  const [task, process] = await Promise.all([
    prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { id: true, clientId: true, title: true, status: true, processId: true } }),
    prisma.process.findFirst({ where: { id: processId, deletedAt: null }, select: { id: true, clientId: true, code: true, title: true, status: true } }),
  ]);
  if (!task) throw new Error("המשימה לא נמצאה.");
  if (!process) throw new Error("התהליך לא נמצא.");
  await assertClientAccess(actor, task.clientId);
  if (task.clientId !== process.clientId) throw new Error("המשימה והתהליך של לקוחות שונים.");
  if (process.status !== "ACTIVE") throw new Error("רק תהליך עם נוהל מאושר מכסה משימות.");
  if (task.processId) throw new Error("זו ריצה של תהליך, לא משימה נפרדת.");
  if (!(OPEN as readonly string[]).includes(task.status)) throw new Error("המשימה כבר לא פתוחה.");
  await updateTask(actor, taskId, { status: "ARCHIVED" });
  await addTaskComment(actor, taskId, `נסגרה: התהליך ${process.code} ${process.title} מכסה את העבודה הזו, וכל ריצה שלו פותחת משימה משלה. /app/clients/${process.clientId}?tab=file#item-${process.id}`);
  await recordAudit({
    actorId: actor.id,
    action: "task.close_covered_by_process",
    entityType: "Task",
    entityId: taskId,
    clientId: task.clientId,
    before: { status: task.status, title: task.title },
    after: { status: "ARCHIVED", processId: process.id, process: `${process.code} ${process.title}` },
  });
}
