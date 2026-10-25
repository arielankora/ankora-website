import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { closeTaskCoveredByProcess, coveredTasksForClients, type CoveredTask } from "@/lib/app-domain/process-overlap";
import { approveProcessVersion, linkProcessDates, linkProcessMention, setProcessFieldNotApplicable } from "@/lib/app-domain/processes";
import { markProcessReviewed } from "@/lib/app-domain/process-review";
import { approveRuleDecision } from "@/lib/app-domain/internal-client";
import { readReviewReason, REVIEW_REASON_LABELS } from "@/lib/process-review";
import { runReadiness } from "@/lib/process-readiness";
import { matchDateToProcess, type DateCandidate, type ProcessFacts, type StepOp } from "@/lib/next-steps";

// The data behind a process's next steps (lib/next-steps.ts), read once
// for a set of clients, and the one door that carries a step out. The
// approvals screen and the process card both read and act through here,
// so a step means the same thing in both places.

/// The recommendation that needs more than the process itself: a date of
/// the client that looks like its own (22.10.2026: the backup is no longer
/// recommended).
export async function stepCandidates(
  clientIds: string[],
  processes: { id: string; clientId: string; code: string; title: string; purpose: string | null; triggerKinds: string[] }[]
): Promise<Map<string, { date: DateCandidate | null }>> {
  const out = new Map<string, { date: DateCandidate | null }>();
  if (processes.length === 0) return out;
  const dates = await prisma.importantDate.findMany({
    where: { clientId: { in: clientIds }, processId: null, deletedAt: null, status: { not: "ARCHIVED" } },
    select: { id: true, clientId: true, title: true },
    orderBy: { title: "asc" },
  });
  for (const p of processes) {
    out.set(p.id, {
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
      triggerText: true,
      ownerId: true,
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
      hasNextDate: !!next,
      draft: null,
      covered: covered.filter((x: CoveredTask) => x.process.id === p.id).map((x) => ({ taskId: x.task.id, title: x.task.title })),
      missing: [],
      noAccess: [],
      review: p.needsReview ? { label: reason ? REVIEW_REASON_LABELS[reason] : "סומן לסקירה", periodic: reason === "PERIODIC" } : null,
      openLessons: p._count.lessons,
      knowledge: { uncertain: false, toResolve: null },
      dateCandidate: c?.date ?? null,
      readiness: runReadiness({ status: p.status, ownerId: p.ownerId, triggerKinds: p.triggerKinds, triggerText: p.triggerText, nextDate: next }),
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
    case "mark_not_applicable":
      await setProcessFieldNotApplicable(actor, op.processId, op.field, true);
      return "סומן כלא רלוונטי";
    case "link_system":
      await linkProcessMention(actor, op.processId, "system", op.systemId);
      return `המערכת קושרה ל-${process.code}`;
    case "link_contact":
      await linkProcessMention(actor, op.processId, "contact", op.contactId);
      return `קושר כגורם חיצוני ב-${process.code}`;
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
