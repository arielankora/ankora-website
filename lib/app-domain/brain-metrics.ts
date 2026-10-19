import "server-only";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import { canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listProcesses } from "@/lib/app-domain/processes";
import { BATCH_WINDOW_DAYS, COVERAGE_WINDOW_DAYS, RUNS_WINDOW_DAYS, metricsReport, type ClientMetricsInput } from "@/lib/brain-metrics";
import { metricsSubject, renderMetricsEmail } from "@/lib/brain-metrics-email";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/email-templates";
import { recordAudit } from "@/lib/app-auth/audit";
import { localDateKey, TIMEZONE } from "@/lib/timezone";

// Spec section 11, for managers: the measures of every client's file, read
// from what the product already records. Nothing here is typed in.

const DAY = 86_400_000;

export async function brainMetrics(actor: User, now = new Date()) {
  if (!canManageClients(actor.role)) throw new ForbiddenError("רק מנהלים רואים את המדדים.");
  const clients = (await listAccessibleClients(actor)).filter((c) => !c.isInternal);
  const ids = clients.map((c) => c.id);
  const since = (days: number) => new Date(now.getTime() - days * DAY);
  const uncertain = { clientId: { in: ids }, deletedAt: null, knowledgeStatus: "UNCERTAIN" as const };
  const pick = { clientId: true, updatedAt: true } as const;

  const [facts, contacts, orgs, systemsU, requests, policies, entities, processesU, systems, autoTasks, runs, pending, decided] = await Promise.all([
    prisma.clientFact.findMany({ where: { ...uncertain, closedAt: null }, select: pick }),
    prisma.clientContact.findMany({ where: uncertain, select: pick }),
    prisma.clientOrganization.findMany({ where: uncertain, select: pick }),
    prisma.systemAccess.findMany({ where: uncertain, select: pick }),
    prisma.requestType.findMany({ where: uncertain, select: pick }),
    prisma.clientPolicy.findMany({ where: uncertain, select: pick }),
    prisma.clientEntity.findMany({ where: uncertain, select: pick }),
    prisma.process.findMany({ where: uncertain, select: pick }),
    prisma.systemAccess.findMany({ where: { clientId: { in: ids }, deletedAt: null }, select: { clientId: true, accessStatus: true } }),
    prisma.task.findMany({
      where: { clientId: { in: ids }, deletedAt: null, parentId: null, createdAt: { gte: since(COVERAGE_WINDOW_DAYS) }, OR: [{ importantDateId: { not: null } }, { processId: { not: null } }] },
      select: { clientId: true, processId: true },
    }),
    prisma.task.findMany({
      where: { clientId: { in: ids }, deletedAt: null, parentId: null, processId: { not: null }, completedAt: { gte: since(RUNS_WINDOW_DAYS) } },
      select: { clientId: true, dueDate: true, completedAt: true },
    }),
    prisma.knowledgeProposal.findMany({ where: { clientId: { in: ids }, state: "PENDING" }, select: { clientId: true, createdAt: true } }),
    prisma.knowledgeProposal.groupBy({
      by: ["batchId", "clientId"],
      where: { clientId: { in: ids }, decidedAt: { not: null }, batch: { closedAt: { gte: since(BATCH_WINDOW_DAYS) } } },
      _min: { decidedAt: true },
      _max: { decidedAt: true },
    }),
  ]);

  const uncertainRows = [...facts, ...contacts, ...orgs, ...systemsU, ...requests, ...policies, ...entities, ...processesU];
  const inputs: ClientMetricsInput[] = [];
  for (const c of clients) {
    const processes = await listProcesses(actor, c.id);
    inputs.push({
      clientId: c.id,
      clientName: c.name,
      processes: processes.map((p) => ({ status: p.status, transitionStatus: p.transitionStatus, backupOwnerId: p.backupOwnerId, completeness: p.completeness.score })),
      uncertainSince: uncertainRows.filter((r) => r.clientId === c.id).map((r) => r.updatedAt),
      systems: systems.filter((s) => s.clientId === c.id),
      autoTasks: autoTasks.filter((t) => t.clientId === c.id),
      runs: runs.filter((r) => r.clientId === c.id),
      pendingProposalsSince: pending.filter((p) => p.clientId === c.id).map((p) => p.createdAt),
      decidedBatches: decided
        .filter((b) => b.clientId === c.id && b._min.decidedAt && b._max.decidedAt)
        .map((b) => ({ firstDecidedAt: b._min.decidedAt!, lastDecidedAt: b._max.decidedAt! })),
    });
  }
  return metricsReport(inputs, now);
}

// ---------------------------------------------------------------------------
// The weekly email (Ariel, 19.10.2026): the same measures, every Sunday
// morning, to Ankora's admins. On the daily cron, so it goes out on the
// first run of the week in Israel; a send is recorded, so a second run that
// day, or a retry, does not send it twice.
// ---------------------------------------------------------------------------

export const WEEKLY_METRICS_ACTION = "brain_metrics.weekly_email";

/// Sunday in Israel.
export function isMetricsDay(now: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: TIMEZONE }).format(now);
  return weekday === "Sun";
}

export async function sendWeeklyBrainMetrics(now = new Date(), options: { force?: boolean } = {}): Promise<{ sent: number; skipped?: string }> {
  if (!options.force && !isMetricsDay(now)) return { sent: 0, skipped: "not Sunday" };
  const admins = await prisma.user.findMany({ where: { role: "ANKORA_ADMIN", status: "ACTIVE", deletedAt: null }, orderBy: { createdAt: "asc" } });
  const weekLabel = localDateKey(now, TIMEZONE).split("-").reverse().join(".");
  const base = appBaseUrl();
  let sent = 0;
  for (const admin of admins) {
    if (!admin.email) continue;
    const already = await prisma.auditEvent.findFirst({
      where: { action: WEEKLY_METRICS_ACTION, entityId: admin.id, createdAt: { gte: new Date(now.getTime() - 6 * DAY) } },
      select: { id: true },
    });
    if (already) continue;
    const report = await brainMetrics(admin, now);
    const { html, text } = renderMetricsEmail(report, admin.name, base, weekLabel);
    const result = await sendEmail({ to: [admin.email], subject: metricsSubject(report, weekLabel), text, html });
    if (!result.ok) continue;
    await recordAudit({ actorId: null, action: "brain_metrics.weekly_email", entityType: "User", entityId: admin.id, after: { week: weekLabel } });
    sent++;
  }
  return { sent };
}
