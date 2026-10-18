import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { findSecrets } from "@/lib/secret-scan";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { lessonError } from "@/lib/process-lessons";

// Learning from runs (claude/org-brain-spec-2026-10-12.md, 5.4).
//
// The person who closed a run is the one who knows whether the procedure
// held. One question, once per run: "was anything wrong or missing?".
// "No" is recorded too, so the question is not asked again and a manager
// can see that runs went by without a remark. A remark waits on the
// process for its owner or a manager: applied in a new version, or
// dismissed with a line. Nothing here changes a procedure by itself: a new
// version is still written and approved on the processes screen.

export const LESSON_ARRIVED = "process.lesson";

async function findRun(actor: User, taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, clientId: true, parentId: true, status: true, deletedAt: true, processId: true, processVersionId: true },
  });
  if (!task || task.deletedAt) throw new Error("המשימה לא נמצאה.");
  await assertClientAccess(actor, task.clientId);
  if (task.parentId || !task.processId) throw new Error("רק ריצה של תהליך נשאלת על הנוהל.");
  return task;
}

/// The answer for one closed run. `body` null: the procedure held.
export async function recordRunLesson(actor: User, taskId: string, body: string | null) {
  assertCan(actor.role, "time_entry.create_self");
  const task = await findRun(actor, taskId);
  if (task.status !== "DONE") throw new Error("שואלים על הנוהל רק אחרי שהריצה הסתיימה.");
  const error = lessonError(body);
  if (error) throw new Error(error);
  const text = body?.trim() || null;
  // A lesson lives on the process and is read by others: no secrets (R4).
  if (text && findSecrets(text).length > 0) throw new Error("יש בטקסט סיסמה, מפתח או מספר כרטיס. סודות נשמרים בכספת, לא בנוהל.");
  if (await prisma.processLesson.findUnique({ where: { taskId } })) throw new Error("כבר ענו על השאלה הזו לריצה הזו.");

  const [process, version] = await Promise.all([
    prisma.process.findUniqueOrThrow({ where: { id: task.processId! }, select: { id: true, code: true, title: true, ownerId: true, backupOwnerId: true } }),
    task.processVersionId ? prisma.processVersion.findUnique({ where: { id: task.processVersionId }, select: { version: true } }) : null,
  ]);
  const lesson = await prisma.processLesson.create({
    data: {
      processId: process.id,
      clientId: task.clientId,
      taskId,
      version: version?.version ?? null,
      status: text ? "OPEN" : "NOTHING",
      body: text,
      authorId: actor.id,
    },
  });
  // The owner hears about a remark; the backup when the owner wrote it.
  const to = text ? (process.ownerId && process.ownerId !== actor.id ? process.ownerId : process.backupOwnerId) : null;
  if (to && to !== actor.id) {
    await prisma.notification.create({
      data: {
        userId: to,
        type: LESSON_ARRIVED,
        title: `הערה על הנוהל: ${process.code} ${process.title}`.slice(0, 200),
        body: `${actor.name} סגר/ה את "${task.title}" וכתב/ה: ${text}`.slice(0, 2000),
        entityType: "ClientProcesses",
        entityId: task.clientId,
      },
    });
  }
  await recordAudit({
    actorId: actor.id,
    action: "process.lesson",
    entityType: "Process",
    entityId: process.id,
    clientId: task.clientId,
    after: { taskId, status: lesson.status, version: lesson.version },
  });
  return lesson;
}

/// Whether the run's question was answered.
export async function runLesson(taskId: string) {
  return prisma.processLesson.findUnique({ where: { taskId }, select: { id: true, status: true, body: true } });
}

/// The remarks on the given processes, open ones first, with the run and
/// who wrote them. The caller passes only processes this person may see.
export async function listLessons(processIds: string[]) {
  if (processIds.length === 0) return [];
  const rows = await prisma.processLesson.findMany({
    where: { processId: { in: processIds }, status: { not: "NOTHING" } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const userIds = [...new Set(rows.flatMap((r) => [r.authorId, r.resolvedById]).filter((x): x is string => !!x))];
  const [users, tasks] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.task.findMany({ where: { id: { in: rows.map((r) => r.taskId) } }, select: { id: true, title: true } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const title = new Map(tasks.map((t) => [t.id, t.title]));
  return rows
    .map((r) => ({ ...r, authorName: r.authorId ? (name.get(r.authorId) ?? null) : null, resolvedByName: r.resolvedById ? (name.get(r.resolvedById) ?? null) : null, runTitle: title.get(r.taskId) ?? null }))
    .sort((a, b) => Number(b.status === "OPEN") - Number(a.status === "OPEN"));
}

/// The process's owner or a manager decides: it went into the procedure,
/// or it does not belong there. Either way with a line that says why.
export async function resolveLesson(actor: User, lessonId: string, status: "APPLIED" | "DISMISSED", resolution: string) {
  assertCan(actor.role, "time_entry.create_self");
  const lesson = await prisma.processLesson.findUnique({ where: { id: lessonId }, include: { process: { select: { ownerId: true } } } });
  if (!lesson) throw new Error("ההערה לא נמצאה.");
  await assertClientAccess(actor, lesson.clientId);
  if (!canManageClients(actor.role) && lesson.process.ownerId !== actor.id) throw new Error("רק הבעלים של התהליך או מנהל מחליטים על הערה לנוהל.");
  if (lesson.status !== "OPEN") throw new Error("כבר הוחלט על ההערה הזו.");
  const line = resolution.trim();
  if (!line) throw new Error(status === "APPLIED" ? "כותבים איפה זה נכנס, למשל \"גרסה 4, שלב 2\"." : "כותבים למה זה לא נכנס לנוהל.");
  const updated = await prisma.processLesson.update({
    where: { id: lessonId },
    data: { status, resolution: line.slice(0, 500), resolvedById: actor.id, resolvedAt: new Date() },
  });
  const applied = status === "APPLIED";
  await recordAudit({
    actorId: actor.id,
    action: applied ? "process.lesson_applied" : "process.lesson_dismissed",
    entityType: "Process",
    entityId: lesson.processId,
    clientId: lesson.clientId,
    after: { lessonId, resolution: updated.resolution },
  });
  return updated;
}
