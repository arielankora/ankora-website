import "server-only";
import { prisma } from "@/lib/prisma";
import type { AutoApplyScope, Prisma, User } from "@prisma/client";
import { assertCan, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { proposalHeadline, revertBlocker, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { proposalKindKey, proposalKindLabel } from "@/lib/knowledge-review-filters";
import {
  CHANGE_ACTIONS,
  CLIENT_WINDOW_DAYS,
  ERROR_WINDOW_DAYS,
  KIND_WINDOW,
  autoErrorAt,
  autoReviewReason,
  clientPauseDue,
  kindPauseDue,
  wilsonLower,
} from "@/lib/auto-apply";

// Auto-apply of proposals to a client file, the parts that read the
// database (3.11.2026, approval tiers part 2; the rules are in
// lib/auto-apply.ts): the switch, the pauses, the list a person looks at
// after the fact, and "תקין".

export const AUTO_APPLY_KEY = "knowledge.auto_apply";
export const AUTO_APPLY_PAUSED = "knowledge.auto_apply_paused";

const DAY = 86_400_000;

export type AutoApplySetting = { enabled: boolean; firstEnabledAt: Date | null };

function readSetting(value: Prisma.JsonValue): AutoApplySetting {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const first = typeof v.firstEnabledAt === "string" ? new Date(v.firstEnabledAt) : null;
  return { enabled: v.enabled !== false, firstEnabledAt: first && !Number.isNaN(first.getTime()) ? first : null };
}

/// The switch for all clients. On by default: a database that never had
/// the row (the migration writes it) gets it now, on, with its first days
/// starting now.
export async function autoApplySetting(): Promise<AutoApplySetting> {
  const row = await prisma.appSetting.findUnique({ where: { key: AUTO_APPLY_KEY } });
  if (row) return readSetting(row.value);
  const created = await prisma.appSetting.upsert({
    where: { key: AUTO_APPLY_KEY },
    create: { key: AUTO_APPLY_KEY, value: { enabled: true, firstEnabledAt: new Date().toISOString() } },
    update: {},
  });
  return readSetting(created.value);
}

/// A manager turns auto-apply on or off for all clients. The first time
/// it is on is kept: the first 14 days count from then.
export async function setAutoApply(actor: User, enabled: boolean): Promise<AutoApplySetting> {
  if (!canManageClients(actor.role)) throw new ForbiddenError("רק מנהל מפעיל או מכבה כניסה אוטומטית.");
  const before = await autoApplySetting();
  const after: AutoApplySetting = { enabled, firstEnabledAt: before.firstEnabledAt ?? (enabled ? new Date() : null) };
  await prisma.appSetting.update({
    where: { key: AUTO_APPLY_KEY },
    data: { value: { enabled, firstEnabledAt: after.firstEnabledAt?.toISOString() ?? null }, updatedById: actor.id },
  });
  await recordAudit({ actorId: actor.id, action: "knowledge.auto_apply_switch", entityType: "AppSetting", entityId: AUTO_APPLY_KEY, before: { enabled: before.enabled }, after: { enabled } });
  return after;
}

/// When each version of the extraction guide was approved, oldest first.
export async function guideApprovals(): Promise<Date[]> {
  const rows = await prisma.extractionGuide.findMany({ where: { state: "APPROVED" }, orderBy: { version: "asc" }, select: { decidedAt: true, createdAt: true } });
  return rows.map((r) => r.decidedAt ?? r.createdAt);
}

export async function activePauses() {
  return prisma.autoApplyPause.findMany({ where: { liftedAt: null }, orderBy: { createdAt: "asc" } });
}

async function lastLift(scope: AutoApplyScope, key: string): Promise<Date | null> {
  const row = await prisma.autoApplyPause.findFirst({ where: { scope, key, liftedAt: { not: null } }, orderBy: { liftedAt: "desc" }, select: { liftedAt: true } });
  return row?.liftedAt ?? null;
}

/// When each auto-applied proposal turned out wrong, or null: taken out
/// again, or its item changed, replaced or removed within 30 days
/// (lib/auto-apply.ts, CHANGE_ACTIONS), read from the item's audit rows.
async function errorTimes(rows: { id: string; resultId: string | null; decidedAt: Date | null; revertedAt: Date | null }[]): Promise<Map<string, Date | null>> {
  const resultIds = [...new Set(rows.flatMap((r) => (r.resultId ? [r.resultId] : [])))];
  const changes = resultIds.length
    ? await prisma.auditEvent.findMany({ where: { entityId: { in: resultIds }, action: { in: [...CHANGE_ACTIONS] } }, select: { entityId: true, createdAt: true } })
    : [];
  const byItem = new Map<string, Date[]>();
  for (const c of changes) byItem.set(c.entityId!, [...(byItem.get(c.entityId!) ?? []), c.createdAt]);
  return new Map(rows.map((r) => [r.id, r.decidedAt ? autoErrorAt({ decidedAt: r.decidedAt, revertedAt: r.revertedAt }, r.resultId ? byItem.get(r.resultId) ?? [] : []) : null]));
}

/// The auto-applied proposals of one kind, by its key (a target, or
/// FACT.<kind>).
function kindWhere(key: string): Prisma.KnowledgeProposalWhereInput {
  const [target, factKind] = key.split(".");
  return { target: target as ProposalTargetLike, ...(factKind ? { payload: { path: ["kind"], equals: factKind } } : {}) };
}

async function managers() {
  return prisma.user.findMany({ where: { role: { in: ["SUPER_ADMIN", "ANKORA_ADMIN"] }, status: "ACTIVE", deletedAt: null }, select: { id: true } });
}

async function pause(scope: AutoApplyScope, key: string, errors: number, reason: string, notice: { title: string; body: string }) {
  // Checked again just before: two arrivals at once pause once.
  const open = await prisma.autoApplyPause.findFirst({ where: { scope, key, liftedAt: null } });
  if (open) return open;
  const row = await prisma.autoApplyPause.create({ data: { scope, key, errors, reason } });
  await recordAudit({ actorId: null, action: "knowledge.auto_apply_pause", entityType: "AutoApplyPause", entityId: row.id, clientId: scope === "CLIENT" ? key : null, after: { scope, key, errors } });
  const to = await managers();
  if (to.length) {
    await prisma.notification.createMany({
      data: to.map((u) => ({ userId: u.id, type: AUTO_APPLY_PAUSED, title: notice.title.slice(0, 200), body: notice.body.slice(0, 500), entityType: "Knowledge", entityId: row.id })),
    });
  }
  return row;
}

/// Whether a client, and which of the given kinds, are sent back to a
/// person now. A rule that is met here and has no pause yet gets one, and
/// the managers are told. Called before auto-applying and after a "ביטול"
/// of an auto-applied item.
export async function evaluateAutoPauses(scope: { clientId: string; kindKeys: string[] }, now = new Date()): Promise<{ clientPaused: boolean; pausedKinds: Set<string> }> {
  const active = await activePauses();
  const pausedKinds = new Set(active.filter((p) => p.scope === "KIND").map((p) => p.key));
  let clientPaused = active.some((p) => p.scope === "CLIENT" && p.key === scope.clientId);

  if (!clientPaused) {
    const rows = await prisma.knowledgeProposal.findMany({
      where: { clientId: scope.clientId, autoApplied: true, decidedAt: { gte: new Date(now.getTime() - (CLIENT_WINDOW_DAYS + ERROR_WINDOW_DAYS) * DAY) } },
      select: { id: true, resultId: true, decidedAt: true, revertedAt: true },
    });
    const errors = [...(await errorTimes(rows)).values()].filter((d): d is Date => !!d);
    const due = clientPauseDue(errors, now, await lastLift("CLIENT", scope.clientId));
    if (due.due) {
      const client = await prisma.client.findUnique({ where: { id: scope.clientId }, select: { name: true } });
      await pause("CLIENT", scope.clientId, due.errors, `${due.errors} פריטים שנכנסו אוטומטית בוטלו או תוקנו בתוך ${CLIENT_WINDOW_DAYS} יום`, {
        title: `כניסה אוטומטית נעצרה ללקוח ${client?.name ?? ""}`,
        body: `${due.errors} פריטים של הלקוח שנכנסו לתיק אוטומטית בוטלו או תוקנו בתוך ${CLIENT_WINDOW_DAYS} יום. מעכשיו ההצעות של הלקוח ממתינות לאישור של אדם. מחזירים אותו לכניסה אוטומטית במסך האישורים, בלשונית "ידע מהחילוץ".`,
      });
      clientPaused = true;
    }
  }

  const guides = await guideApprovals();
  const lastGuide = guides.length ? guides[guides.length - 1] : null;
  for (const key of new Set(scope.kindKeys)) {
    if (pausedKinds.has(key)) continue;
    const lift = await lastLift("KIND", key);
    const since = [lastGuide, lift].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const rows = await prisma.knowledgeProposal.findMany({
      where: { ...kindWhere(key), autoApplied: true, decidedAt: since ? { gt: since } : { not: null } },
      orderBy: { decidedAt: "desc" },
      take: KIND_WINDOW,
      select: { id: true, resultId: true, decidedAt: true, revertedAt: true },
    });
    const errs = await errorTimes(rows);
    const due = kindPauseDue(rows.map((r) => ({ decidedAt: r.decidedAt!, error: !!errs.get(r.id) })), since);
    if (!due.due) continue;
    const label = proposalKindLabel(key);
    await pause("KIND", key, due.errors, `${due.errors} מתוך ${due.counted} הפריטים האחרונים מסוג ${label} שנכנסו אוטומטית בוטלו או תוקנו`, {
      title: `כניסה אוטומטית נעצרה: ${label}`,
      body: `${due.errors} מתוך ${due.counted} הפריטים האחרונים מסוג ${label} שנכנסו לתיקים אוטומטית בוטלו או תוקנו. מעכשיו הצעות מהסוג הזה ממתינות לאישור של אדם. מחזירים אותו לכניסה אוטומטית במסך האישורים, בלשונית "ידע מהחילוץ".`,
    });
    pausedKinds.add(key);
  }
  return { clientPaused, pausedKinds };
}

/// A manager sends a kind or a client back to auto-apply. Its counters
/// start again from now.
export async function liftAutoApplyPause(actor: User, id: string) {
  if (!canManageClients(actor.role)) throw new ForbiddenError("רק מנהל מחזיר לכניסה אוטומטית.");
  const done = await prisma.autoApplyPause.updateMany({ where: { id, liftedAt: null }, data: { liftedAt: new Date(), liftedById: actor.id } });
  if (done.count === 0) throw new Error("העצירה כבר הוסרה.");
  const row = await prisma.autoApplyPause.findUniqueOrThrow({ where: { id } });
  await recordAudit({ actorId: actor.id, action: "knowledge.auto_apply_lift", entityType: "AutoApplyPause", entityId: id, clientId: row.scope === "CLIENT" ? row.key : null, after: { scope: row.scope, key: row.key } });
  return row;
}

/// The switch and the pauses, for the managers on the approvals screen.
/// Beside each pause, the decisions people took on its proposals since it
/// began, one at a time, and how many were approved as they came: the bar
/// for lifting it (30 decisions, a lower bound of 85%) is checked by the
/// manager.
export async function autoApplyOverview(actor: User) {
  if (!canManageClients(actor.role)) return null;
  const [setting, pauses] = await Promise.all([autoApplySetting(), activePauses()]);
  const clientIds = pauses.filter((p) => p.scope === "CLIENT").map((p) => p.key);
  const clients = clientIds.length ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  const out = [];
  for (const p of pauses) {
    const decided = await prisma.knowledgeProposal.findMany({
      where: {
        ...(p.scope === "KIND" ? kindWhere(p.key) : { clientId: p.key }),
        autoApplied: false,
        state: { in: ["APPROVED", "REJECTED"] },
        decidedAt: { gte: p.createdAt },
      },
      select: { id: true, state: true, edited: true },
    });
    const bulk = decided.length
      ? new Set(
          (
            await prisma.auditEvent.findMany({
              where: { entityType: "KnowledgeProposal", entityId: { in: decided.map((d) => d.id) }, action: { in: ["knowledge_proposal.approve", "knowledge_proposal.reject"] } },
              select: { entityId: true, afterJson: true },
            })
          )
            .filter((a) => (a.afterJson as { bulk?: unknown } | null)?.bulk === true)
            .map((a) => a.entityId)
        )
      : new Set<string | null>();
    const alone = decided.filter((d) => !bulk.has(d.id));
    const good = alone.filter((d) => d.state === "APPROVED" && !d.edited).length;
    out.push({
      id: p.id,
      scope: p.scope,
      label: p.scope === "KIND" ? proposalKindLabel(p.key) : nameOf.get(p.key) ?? "לקוח",
      reason: p.reason,
      since: p.createdAt,
      decisions: alone.length,
      approvedAsIs: good,
      lowerBound: wilsonLower(good, alone.length),
    });
  }
  return { enabled: setting.enabled, firstEnabledAt: setting.firstEnabledAt, pauses: out };
}

export type AutoReviewItem = {
  id: string;
  clientId: string;
  clientName: string;
  target: ProposalTargetLike;
  kindLabel: string;
  headline: string;
  resultId: string | null;
  decidedAt: Date;
  why: string;
  /// "ביטול" may still take its item out (revertBlocker).
  revertible: boolean;
};

/// "נכנס אוטומטית": auto-applied items a person still looks at, newest
/// first (lib/auto-apply.ts, needsAutoReview). `forAi` leaves out the
/// clients marked "בלי AI" (none should be here: they never auto-apply).
export async function listAutoReview(actor: User, filter: { clientId?: string | null; forAi?: boolean } = {}): Promise<AutoReviewItem[]> {
  assertCan(actor.role, "time_entry.create_self");
  let clients = await listAccessibleClients(actor);
  if (filter.clientId) clients = clients.filter((c) => c.id === filter.clientId);
  if (filter.forAi) clients = clients.filter((c) => !c.aiExcluded);
  if (clients.length === 0) return [];
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  const [rows, setting, guides] = await Promise.all([
    prisma.knowledgeProposal.findMany({
      where: { clientId: { in: [...nameOf.keys()] }, autoApplied: true, state: "APPROVED", revertedAt: null, autoReviewedAt: null },
      orderBy: { decidedAt: "desc" },
      take: 500,
      select: { id: true, clientId: true, target: true, payload: true, resultId: true, decidedAt: true, state: true, action: true, attached: true, revertedAt: true },
    }),
    autoApplySetting(),
    guideApprovals(),
  ]);
  const out: AutoReviewItem[] = [];
  for (const r of rows) {
    if (!r.decidedAt) continue;
    const why = autoReviewReason({ id: r.id, decidedAt: r.decidedAt }, { firstEnabledAt: setting.firstEnabledAt, guideApprovals: guides });
    if (!why) continue;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const target = r.target as ProposalTargetLike;
    out.push({
      id: r.id,
      clientId: r.clientId,
      clientName: nameOf.get(r.clientId) ?? "",
      target,
      kindLabel: proposalKindLabel(proposalKindKey({ target, payload })),
      headline: proposalHeadline(target, payload),
      resultId: r.resultId,
      decidedAt: r.decidedAt,
      why,
      revertible: revertBlocker(r) === null,
    });
  }
  return out;
}

/// How many auto-applied items wait for a person's look: the "נכנס
/// אוטומטית" list, counted on "ידע מהחילוץ", beside "אישורים" in the menu
/// and in the morning email. One set, read by listAutoReview.
export async function countAutoReview(actor: User, filter: { clientId?: string | null } = {}): Promise<number> {
  return (await listAutoReview(actor, filter)).length;
}

/// "תקין": a person looked at an auto-applied item and it is right.
export async function markAutoReviewed(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const p = await prisma.knowledgeProposal.findUnique({ where: { id }, select: { clientId: true, autoApplied: true, revertedAt: true } });
  if (!p) throw new Error("ההצעה לא נמצאה.");
  await assertClientAccess(actor, p.clientId);
  if (!p.autoApplied) throw new Error("ההצעה לא נכנסה אוטומטית.");
  if (p.revertedAt) throw new Error("הפריט כבר הוסר מהתיק.");
  const done = await prisma.knowledgeProposal.updateMany({ where: { id, autoReviewedAt: null }, data: { autoReviewedAt: new Date(), autoReviewedById: actor.id } });
  if (done.count === 0) throw new Error("כבר סומן כתקין.");
  await recordAudit({ actorId: actor.id, action: "knowledge_proposal.auto_review", entityType: "KnowledgeProposal", entityId: id, clientId: p.clientId });
}
