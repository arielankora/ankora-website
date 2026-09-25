import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { ForbiddenError, assertCan } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { resolvePortalClient } from "@/lib/app-domain/client-portal";
import { OPEN_STATUSES, TOP_LEVEL_ONLY } from "@/lib/app-domain/tasks";
import type { User } from "@prisma/client";

// Portal phase 3: the monthly summary.
//
// The design asked for "סיכום מנהל התיק" in prose, and the first pass of
// the portal left it out because there was nothing behind it. The spec's
// answer is to produce it from the records that are already collected
// rather than to ask an account manager to write one per client per
// month, and to hold it to two rules that do not bend: nothing generated
// reaches the client until a person approves it, and every sentence must
// trace back to a task, a decision or a date.
//
// So there is no model in this file.
//
// That is not a placeholder for one. A sentence assembled from the rows
// cannot invent a supplier who was never used or a decision that was
// never taken - the traceability rule is satisfied by construction rather
// than by review - and the ids the draft was built from are stored beside
// it, so the person approving it checks the draft against the rows.
// Language that reads better is a layer that can sit on top of this
// later; it is not what makes the summary true.

const JERUSALEM = "Asia/Jerusalem";

function monthName(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: JERUSALEM }).format(date);
}

/// The calendar month containing `anchor`, in the client's timezone sense
/// of a month. Returned as the half-open range every query here uses.
export function monthRange(anchor: Date): { periodStart: Date; periodEnd: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: JERUSALEM, year: "numeric", month: "2-digit" })
    .format(anchor)
    .split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  // Built in UTC from the Jerusalem calendar month. Jerusalem is ahead of
  // UTC, so this is off by the offset at the boundary - which matters for
  // a report of the month and not for a sentence about it, and choosing
  // the simpler arithmetic keeps this readable by whoever checks it.
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
  return { periodStart, periodEnd };
}

function list(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  if (names.length > max) return `${shown.join(", ")} ועוד ${names.length - max}`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} ו${shown[shown.length - 1]}`;
}

export interface SummaryDraft {
  text: string;
  sourceTaskIds: string[];
  sourceDecisionIds: string[];
}

/// Assemble the draft. Nothing here is written to the database - that is
/// generatePortalSummary's job - so this stays callable from a test with
/// a client id and two dates.
export async function buildSummaryDraft(clientId: string, periodStart: Date, periodEnd: Date): Promise<SummaryDraft> {
  const [closed, answered, suppliers, stillOpen] = await Promise.all([
    prisma.task.findMany({
      where: {
        clientId,
        deletedAt: null,
        ...TOP_LEVEL_ONLY,
        clientVisible: true,
        status: "DONE",
        // Which month a promise belongs to is the month it CLOSED.
        // `updatedAt` answered that only by accident: it moves again on
        // every later edit, so a task finished in August and retitled in
        // September counted as September's work. The fallback covers
        // rows closed before completedAt existed.
        OR: [
          { completedAt: { gte: periodStart, lt: periodEnd } },
          { completedAt: null, updatedAt: { gte: periodStart, lt: periodEnd } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, clientTitle: true, clientOutcome: true },
    }),
    prisma.decision.findMany({
      where: { clientId, status: "ANSWERED", updatedAt: { gte: periodStart, lt: periodEnd } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, question: true },
    }),
    prisma.task.findMany({
      where: {
        clientId,
        deletedAt: null,
        ...TOP_LEVEL_ONLY,
        clientVisible: true,
        supplierName: { not: null },
        supplierRecordedAt: { gte: periodStart, lt: periodEnd },
      },
      select: { id: true, supplierName: true },
    }),
    prisma.task.count({
      // OPEN_STATUSES rather than the list written out: phase 2 added
      // PENDING_APPROVAL and a second copy of "what counts as open" is a
      // copy that gets missed. It was missed here once already.
      where: { clientId, deletedAt: null, ...TOP_LEVEL_ONLY, clientVisible: true, status: { in: OPEN_STATUSES } },
    }),
  ]);

  const sentences: string[] = [];
  const period = monthName(periodStart);

  if (closed.length === 0 && answered.length === 0) {
    // An empty month is a fact, and saying it plainly is better than
    // sending a cheerful paragraph about nothing. The account manager
    // reads this before anyone else does and can discard it.
    sentences.push(`ב${period} לא נסגרה אף הבטחה ולא התקבלה אף החלטה.`);
  } else {
    if (closed.length > 0) {
      // The outcome, when there is one, and the title only as a fallback
      // for rows closed before the definition of done existed. A summary
      // built from titles lists what the client asked for; one built
      // from outcomes tells them what they got, which is the entire
      // reason the summary is sent.
      const titles = closed.map((t) => t.clientOutcome?.trim() || t.clientTitle?.trim() || t.title);
      sentences.push(
        closed.length === 1
          ? `ב${period} סגרנו עבורך דבר אחד: ${titles[0]}.`
          : `ב${period} סגרנו עבורך ${closed.length} דברים, ובהם ${list(titles)}.`
      );
    }
    if (answered.length > 0) {
      sentences.push(
        answered.length === 1
          ? `התקבלה החלטה אחת: ${answered[0].question}`
          : `התקבלו ${answered.length} החלטות, ובהן ${list(answered.map((d) => d.question))}.`
      );
    }
  }

  const supplierNames = [...new Set(suppliers.map((s) => s.supplierName as string))];
  if (supplierNames.length > 0) {
    sentences.push(
      supplierNames.length === 1
        ? `תיאמנו עבורך את ${supplierNames[0]}, והוא נרשם בתיק שלך.`
        : `תיאמנו עבורך ${supplierNames.length} גורמים: ${list(supplierNames)}. כולם נרשמו בתיק שלך.`
    );
  }

  sentences.push(
    stillOpen === 0
      ? "אין כרגע דבר פתוח שדורש מעקב מצדך."
      : stillOpen === 1
        ? "דבר אחד נשאר בטיפול, ואנחנו מחזיקים אותו."
        : `${stillOpen} דברים נשארו בטיפול, ואנחנו מחזיקים אותם.`
  );

  return {
    text: sentences.join(" "),
    sourceTaskIds: [...closed.map((t) => t.id), ...suppliers.map((s) => s.id)],
    sourceDecisionIds: answered.map((d) => d.id),
  };
}

async function assertClientAccess(actor: User, clientId: string) {
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }
}

/// Build (or rebuild) this month's draft for a client.
///
/// Regenerating replaces the draft in place. A second row for the same
/// month would mean somebody could approve the stale one, and a summary
/// is the one thing here the client reads as our word.
export async function generatePortalSummary(actor: User, clientId: string, anchor: Date = new Date()) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);

  const { periodStart, periodEnd } = monthRange(anchor);
  const draft = await buildSummaryDraft(clientId, periodStart, periodEnd);

  const summary = await prisma.portalSummary.upsert({
    where: { clientId_periodStart: { clientId, periodStart } },
    create: {
      clientId,
      periodStart,
      periodEnd,
      draft: draft.text,
      sourceTaskIds: draft.sourceTaskIds,
      sourceDecisionIds: draft.sourceDecisionIds,
    },
    update: {
      periodEnd,
      draft: draft.text,
      sourceTaskIds: draft.sourceTaskIds,
      sourceDecisionIds: draft.sourceDecisionIds,
      generatedAt: new Date(),
      // Regenerating un-approves: what the person signed is no longer
      // what the row says, and carrying the approval over would attach
      // their name to words they never read.
      status: "DRAFT",
      approvedById: null,
      approvedAt: null,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "portal_summary.generate",
    entityType: "PortalSummary",
    entityId: summary.id,
    clientId,
  });

  return summary;
}

/// A person putting their name to it. `edited` carries whatever the
/// approver changed in the box before pressing the button - the draft is
/// a starting point, not a script.
export async function approvePortalSummary(actor: User, summaryId: string, edited?: string) {
  assertCan(actor.role, "time_entry.create_self");

  const existing = await prisma.portalSummary.findUnique({ where: { id: summaryId } });
  if (!existing) throw new Error("הסיכום לא נמצא.");
  await assertClientAccess(actor, existing.clientId);

  const text = (edited ?? existing.draft).trim();
  if (!text) throw new Error("אי אפשר לאשר סיכום ריק.");

  const summary = await prisma.portalSummary.update({
    where: { id: summaryId },
    data: { draft: text, status: "APPROVED", approvedById: actor.id, approvedAt: new Date() },
  });

  await recordAudit({
    actorId: actor.id,
    action: "portal_summary.approve",
    entityType: "PortalSummary",
    entityId: summary.id,
    clientId: summary.clientId,
    before: existing,
    after: summary,
  });

  return summary;
}

export async function discardPortalSummary(actor: User, summaryId: string) {
  assertCan(actor.role, "time_entry.create_self");

  const existing = await prisma.portalSummary.findUnique({ where: { id: summaryId } });
  if (!existing) throw new Error("הסיכום לא נמצא.");
  await assertClientAccess(actor, existing.clientId);

  const summary = await prisma.portalSummary.update({
    where: { id: summaryId },
    data: { status: "DISCARDED", approvedById: null, approvedAt: null },
  });

  await recordAudit({
    actorId: actor.id,
    action: "portal_summary.discard",
    entityType: "PortalSummary",
    entityId: summary.id,
    clientId: summary.clientId,
  });

  return summary;
}

export async function listPortalSummaries(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);

  return prisma.portalSummary.findMany({
    where: { clientId },
    orderBy: { periodStart: "desc" },
    take: 12,
    include: { approvedBy: { select: { name: true } } },
  });
}

/// What the client reads. APPROVED only: a draft does not exist as far as
/// the portal is concerned, which is the whole of the first rule.
export async function getApprovedSummaries(actor: User) {
  const { client } = await resolvePortalClient(actor);

  return prisma.portalSummary.findMany({
    where: { clientId: client.id, status: "APPROVED", approvedById: { not: null } },
    orderBy: { periodStart: "desc" },
    take: 6,
    select: { id: true, periodStart: true, draft: true, approvedAt: true },
  });
}
