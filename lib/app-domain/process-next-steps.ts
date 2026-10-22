import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { closeTaskCoveredByProcess, coveredTasksForClients, type CoveredTask } from "@/lib/app-domain/process-overlap";
import { approveProcessVersion, linkProcessDates } from "@/lib/app-domain/processes";
import { markProcessReviewed } from "@/lib/app-domain/process-review";
import { approveRuleDecision } from "@/lib/app-domain/internal-client";
import { readReviewReason, REVIEW_REASON_LABELS } from "@/lib/process-review";
import { matchDateToProcess, recommendBackup, type BackupCandidate, type DateCandidate, type PoolMember, type ProcessFacts, type StaffSignal, type StepOp } from "@/lib/next-steps";

// The data behind a process's next steps (lib/next-steps.ts), read once
// for a set of clients, and the one door that carries a step out. The
// approvals screen and the process card both read and act through here,
// so a step means the same thing in both places.

const OPEN = ["OPEN", "IN_PROGRESS"] as const;

/// Who runs work, as opposed to only managing it (22.10.2026): anyone on
/// the team who is not a manager, and a manager who owns or backs up a
/// process somewhere. Ariel manages every client and owns none of the
/// processes, so he is never suggested as someone's backup.
async function operatorIds(): Promise<{ operators: Set<string>; pool: PoolMember[] }> {
  const [users, holders] = await Promise.all([
    prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE", role: { not: "CLIENT_USER" } }, select: { id: true, name: true, role: true } }),
    prisma.process.findMany({ where: { deletedAt: null, status: { not: "RETIRED" } }, select: { ownerId: true, backupOwnerId: true } }),
  ]);
  const holds = new Set<string>();
  for (const p of holders) for (const id of [p.ownerId, p.backupOwnerId]) if (id) holds.add(id);
  const operators = new Set(users.filter((u) => !canManageClients(u.role) || holds.has(u.id)).map((u) => u.id));
  return { operators, pool: users.filter((u) => operators.has(u.id)).map((u) => ({ id: u.id, name: u.name })) };
}

/// Who already works on each client, for the backup to recommend.
export async function staffSignals(clientIds: string[]): Promise<Map<string, StaffSignal[]>> {
  const out = new Map<string, StaffSignal[]>();
  if (clientIds.length === 0) return out;
  const [clients, tasks, processes, { operators }] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, accountManagerId: true } }),
    prisma.task.groupBy({
      by: ["clientId", "assignedToId"],
      where: { clientId: { in: clientIds }, deletedAt: null, status: { in: [...OPEN] }, assignedToId: { not: null } },
      _count: { _all: true },
    }),
    prisma.process.findMany({
      where: { clientId: { in: clientIds }, deletedAt: null, status: { not: "RETIRED" } },
      select: { clientId: true, code: true, ownerId: true, backupOwnerId: true },
    }),
    operatorIds(),
  ]);
  const ids = new Set<string>();
  for (const c of clients) if (c.accountManagerId) ids.add(c.accountManagerId);
  for (const t of tasks) if (t.assignedToId) ids.add(t.assignedToId);
  for (const p of processes) for (const id of [p.ownerId, p.backupOwnerId]) if (id) ids.add(id);
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] }, deletedAt: null, status: "ACTIVE", role: { not: "CLIENT_USER" } },
    select: { id: true, name: true },
  });
  const name = new Map(users.map((u) => [u.id, u.name]));
  for (const c of clients) {
    const byUser = new Map<string, StaffSignal>();
    const of = (id: string) => {
      let s = byUser.get(id);
      if (!s) {
        s = { id, name: name.get(id)!, accountManager: false, openTasks: 0, processes: [], backs: [], operator: operators.has(id) };
        byUser.set(id, s);
      }
      return s;
    };
    if (c.accountManagerId && name.has(c.accountManagerId)) of(c.accountManagerId).accountManager = true;
    for (const t of tasks) if (t.clientId === c.id && t.assignedToId && name.has(t.assignedToId)) of(t.assignedToId).openTasks += t._count._all;
    for (const p of processes) {
      if (p.clientId !== c.id) continue;
      for (const id of [p.ownerId, p.backupOwnerId]) if (id && name.has(id) && !of(id).processes.includes(p.code)) of(id).processes.push(p.code);
      if (p.backupOwnerId && name.has(p.backupOwnerId)) of(p.backupOwnerId).backs!.push(p.code);
    }
    out.set(c.id, [...byUser.values()]);
  }
  return out;
}

/// The two recommendations that need more than the process itself: who
/// could back it up, and a date of the client that looks like its own.
export async function stepCandidates(
  clientIds: string[],
  processes: { id: string; clientId: string; code: string; title: string; purpose: string | null; ownerId: string | null; backupOwnerId: string | null; triggerKinds: string[] }[]
): Promise<Map<string, { backup: BackupCandidate | null; date: DateCandidate | null }>> {
  const out = new Map<string, { backup: BackupCandidate | null; date: DateCandidate | null }>();
  if (processes.length === 0) return out;
  const [signals, dates, { pool }] = await Promise.all([
    staffSignals(clientIds),
    prisma.importantDate.findMany({
      where: { clientId: { in: clientIds }, processId: null, deletedAt: null, status: { not: "ARCHIVED" } },
      select: { id: true, clientId: true, title: true },
      orderBy: { title: "asc" },
    }),
    operatorIds(),
  ]);
  for (const p of processes) {
    // Each process its own backup, without the owner of this one.
    const staff = (signals.get(p.clientId) ?? []).map((s) => ({ ...s, processes: s.processes.filter((c) => c !== p.code), backs: (s.backs ?? []).filter((c) => c !== p.code) }));
    out.set(p.id, {
      backup: p.backupOwnerId ? null : recommendBackup(p.ownerId, staff, pool),
      date: p.triggerKinds.includes("SCHEDULED")
        ? matchDateToProcess(
            p,
            dates.filter((d) => d.clientId === p.clientId)
          )
        : null,
    });
  }
  return out;
}

export type ProcessDecision = {
  clientId: string;
  facts: ProcessFacts;
  /// The nearest of its dates, or of the tasks it covers: what makes it
  /// urgent this week.
  deadline: Date | null;
  updatedAt: Date;
};

/// Every process of these clients, as next steps read it, for the
/// approvals screen. A procedure draft is left out here: it has a row of
/// its own there, with its preview.
export async function processDecisions(clientIds: string[], filter: (p: { clientId: string; ownerId: string | null }) => boolean): Promise<ProcessDecision[]> {
  if (clientIds.length === 0) return [];
  const rows = await prisma.process.findMany({
    where: { clientId: { in: clientIds }, deletedAt: null, status: { not: "RETIRED" } },
    select: {
      id: true,
      clientId: true,
      code: true,
      title: true,
      purpose: true,
      status: true,
      triggerKinds: true,
      ownerId: true,
      backupOwnerId: true,
      needsReview: true,
      reviewReason: true,
      knowledgeStatus: true,
      toResolve: true,
      updatedAt: true,
      dates: { where: { deletedAt: null, status: { not: "ARCHIVED" }, nextOccurrenceAt: { not: null } }, select: { nextOccurrenceAt: true } },
      _count: { select: { lessons: { where: { status: "OPEN" } } } },
    },
    orderBy: [{ clientId: "asc" }, { seq: "asc" }],
  });
  const mine = rows.filter(filter);
  if (mine.length === 0) return [];
  const [covered, candidates] = await Promise.all([coveredTasksForClients([...new Set(mine.map((p) => p.clientId))]), stepCandidates(clientIds, mine)]);
  return mine.map((p) => {
    const next = p.dates.map((d) => d.nextOccurrenceAt!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const reason = p.needsReview ? readReviewReason(p.reviewReason) : null;
    const c = candidates.get(p.id);
    const facts: ProcessFacts = {
      id: p.id,
      code: p.code,
      title: p.title,
      purpose: p.purpose,
      status: p.status,
      triggerKinds: p.triggerKinds,
      ownerId: p.ownerId,
      backupOwnerId: p.backupOwnerId,
      hasNextDate: !!next,
      draft: null,
      covered: covered.filter((x: CoveredTask) => x.process.id === p.id).map((x) => ({ taskId: x.task.id, title: x.task.title })),
      missing: [],
      noAccess: [],
      review: p.needsReview ? { label: reason ? REVIEW_REASON_LABELS[reason] : "סומן לסקירה", periodic: reason === "PERIODIC" } : null,
      openLessons: p._count.lessons,
      knowledge: { uncertain: false, toResolve: null },
      backupCandidate: c?.backup ?? null,
      dateCandidate: c?.date ?? null,
    };
    return { clientId: p.clientId, facts, deadline: next, updatedAt: p.updatedAt };
  });
}

/// Carries out one step, through the domain function its own screen calls,
/// with the same checks. Returns what was done, in words.
export async function runStep(actor: User, op: StepOp): Promise<string> {
  const process = await prisma.process.findFirst({ where: { id: op.processId, deletedAt: null }, select: { id: true, clientId: true, code: true } });
  if (!process) throw new Error("התהליך לא נמצא.");
  await assertClientAccess(actor, process.clientId);
  switch (op.type) {
    case "set_backup": {
      // Only the backup changes, so the rest of the process (its sources,
      // its status) is not asked for again, as an edit of all of it would.
      const u = await prisma.user.findFirst({ where: { id: op.userId, deletedAt: null, role: { not: "CLIENT_USER" } }, select: { name: true } });
      if (!u) throw new Error("מחליף צריך להיות איש צוות של אנקורה.");
      const before = await prisma.process.findUniqueOrThrow({ where: { id: op.processId }, select: { ownerId: true, backupOwnerId: true } });
      if (before.ownerId === op.userId) throw new Error("המחליף לא יכול להיות הבעלים של התהליך.");
      await prisma.process.update({ where: { id: op.processId }, data: { backupOwnerId: op.userId } });
      await recordAudit({ actorId: actor.id, action: "process.update", entityType: "Process", entityId: op.processId, clientId: process.clientId, before: { backupOwnerId: before.backupOwnerId }, after: { backupOwnerId: op.userId } });
      return `${u.name} נקבע כמחליף ב-${process.code}`;
    }
    case "link_date": {
      const linked = await prisma.importantDate.findMany({ where: { processId: op.processId, deletedAt: null }, select: { id: true } });
      await linkProcessDates(actor, op.processId, [...linked.map((d) => d.id), op.dateId]);
      return `המועד קושר ל-${process.code}`;
    }
    case "close_covered": {
      if (!canManageClients(actor.role)) throw new Error("רק מנהל סוגר משימה בגלל שתהליך מכסה אותה.");
      for (const id of op.taskIds) await closeTaskCoveredByProcess(actor, id, op.processId);
      return op.taskIds.length === 1 ? "המשימה נסגרה" : `${op.taskIds.length} משימות נסגרו`;
    }
    case "approve_procedure":
      await approveProcessVersion(actor, op.processId, op.version);
      return "הנוהל אושר";
    case "mark_reviewed":
      await markProcessReviewed(actor, op.processId);
      return "סומן כנסקר";
  }
}

/// Approves several proposed rules of one client at once: each through
/// approveClientPolicy, so each is checked and recorded on its own, and one
/// that fails stops nothing else. The batch itself is recorded too.
export async function approveRulesTogether(actor: User, clientId: string, ids: string[]): Promise<{ approved: number; failed: string[] }> {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל מאשר כללים.");
  await assertClientAccess(actor, clientId);
  const rules = await prisma.clientPolicy.findMany({ where: { id: { in: ids }, clientId, status: "PROPOSED", deletedAt: null }, select: { id: true, title: true } });
  let approved = 0;
  const failed: string[] = [];
  for (const r of rules) {
    try {
      await approveRuleDecision(actor, r.id);
      approved++;
    } catch (e) {
      failed.push(`${r.title}: ${e instanceof Error ? e.message : "שגיאה"}`);
    }
  }
  await recordAudit({ actorId: actor.id, action: "client_policy.approve_together", entityType: "Client", entityId: clientId, clientId, after: { approved, failed: failed.length } });
  return { approved, failed };
}
