import "server-only";
import { outgoingForUsers } from "@/lib/i18n/recipients";
import { HEBREW, type OutgoingT } from "@/lib/i18n/outgoing";
import { prisma } from "@/lib/prisma";
import type { AutoApplyScope, Prisma, User } from "@prisma/client";
import { assertCan, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { DomainError } from "@/lib/domain-error";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { proposalHeadline, revertBlocker, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { proposalKindKey, proposalKindLabel } from "@/lib/knowledge-review-filters";
import {
  CHANGE_ACTIONS,
  CLIENT_WINDOW_DAYS,
  ERROR_WINDOW_DAYS,
  KIND_WINDOW,
  REVERT_SLACK_MS,
  autoOutcome,
  autoReviewReason,
  autoReviewReasonCode,
  clientPauseDue,
  clientWindow,
  kindPauseDue,
  kindWindow,
  summarizeAutoErrors,
  wilsonLower,
  proposalSource,
  type AutoChange,
  type AutoError,
  type AutoErrorSummary,
  type ItemChange,
  type ProposalSource,
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

/// The latest lift of a pause on this kind or client, before `before`
/// when given (a pause still open: the lift before it began).
async function lastLift(scope: AutoApplyScope, key: string, before?: Date): Promise<Date | null> {
  const row = await prisma.autoApplyPause.findFirst({
    where: { scope, key, liftedAt: before ? { not: null, lte: before } : { not: null } },
    orderBy: { liftedAt: "desc" },
    select: { liftedAt: true },
  });
  return row?.liftedAt ?? null;
}

type AutoRow = { id: string; batchId: string; resultId: string | null; decidedAt: Date | null; revertedAt: Date | null };
const AUTO_ROW = { id: true, batchId: true, resultId: true, decidedAt: true, revertedAt: true } as const;

/// The source of each batch (lib/auto-apply.ts, proposalSource).
async function batchSources(batchIds: string[]): Promise<Map<string, ProposalSource>> {
  const ids = [...new Set(batchIds)];
  if (ids.length === 0) return new Map();
  const batches = await prisma.knowledgeBatch.findMany({ where: { id: { in: ids } }, select: { id: true, createdAt: true, sourceId: true } });
  const sourceIds = [...new Set(batches.flatMap((b) => (b.sourceId ? [b.sourceId] : [])))];
  const sources = sourceIds.length ? await prisma.clientSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, occurredAt: true } }) : [];
  const sourceOf = new Map(sources.map((x) => [x.id, x]));
  return new Map(batches.map((b) => [b.id, proposalSource(b, b.sourceId ? sourceOf.get(b.sourceId) ?? null : null)]));
}

const BY_PROPOSAL = { "client_fact.supersede": "SUPERSEDE", "client_fact.contradict": "CONTRADICT" } as const;

/// The outcome of each auto-applied proposal (lib/auto-apply.ts,
/// autoOutcome): its error, or null, and the changes not counted (a
/// replacement or a contradiction a later source brought). Read from the
/// item's audit rows; a replacement or a contradiction is tied to the
/// approved proposal that made it (the same fact, the same person, decided
/// within a minute after the row), and through it to its source. One
/// with no such proposal is a person's change on the screen.
export async function autoOutcomes(rows: AutoRow[]): Promise<Map<string, { error: AutoError | null; notCounted: AutoChange[] }>> {
  const resultIds = [...new Set(rows.flatMap((r) => (r.resultId ? [r.resultId] : [])))];
  const changes = resultIds.length
    ? await prisma.auditEvent.findMany({
        where: { entityId: { in: resultIds }, action: { in: [...CHANGE_ACTIONS] } },
        select: { entityId: true, action: true, actorId: true, createdAt: true, beforeJson: true, afterJson: true },
      })
    : [];
  const replaced = [...new Set(changes.flatMap((c) => (c.entityId && c.action in BY_PROPOSAL ? [c.entityId] : [])))];
  const makers = replaced.length
    ? await prisma.knowledgeProposal.findMany({
        where: { targetId: { in: replaced }, action: { in: ["SUPERSEDE", "CONTRADICT"] }, state: "APPROVED", decidedAt: { not: null } },
        select: { id: true, targetId: true, action: true, decidedById: true, decidedAt: true, batchId: true },
      })
    : [];
  // Sources matter only beside a proposal that replaced or contradicted.
  const sourceOf = makers.length ? await batchSources([...rows.map((r) => r.batchId), ...makers.map((m) => m.batchId)]) : new Map<string, ProposalSource>();
  /// The approved proposal that wrote this row: the row is written while
  /// it is approved, a moment before its decidedAt.
  const makerOf = (c: (typeof changes)[number]) => {
    const action = BY_PROPOSAL[c.action as keyof typeof BY_PROPOSAL];
    if (!action) return null;
    const t = c.createdAt.getTime();
    return (
      makers
        .filter((m) => m.targetId === c.entityId && m.action === action && m.decidedById === c.actorId)
        .map((m) => ({ m, d: m.decidedAt!.getTime() - t }))
        .filter((x) => x.d >= -5_000 && x.d <= REVERT_SLACK_MS)
        .sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0]?.m ?? null
    );
  };
  const byItem = new Map<string, ItemChange[]>();
  for (const c of changes) {
    if (!c.entityId) continue;
    const maker = makerOf(c);
    byItem.set(c.entityId, [
      ...(byItem.get(c.entityId) ?? []),
      { action: c.action, at: c.createdAt, before: c.beforeJson, after: c.afterJson, by: maker ? sourceOf.get(maker.batchId) ?? null : null },
    ]);
  }
  const none = { error: null, notCounted: [] };
  return new Map(
    rows.map((r) => [
      r.id,
      r.decidedAt ? autoOutcome({ decidedAt: r.decidedAt, revertedAt: r.revertedAt, source: sourceOf.get(r.batchId) ?? null }, r.resultId ? byItem.get(r.resultId) ?? [] : []) : none,
    ])
  );
}

/// The error of each auto-applied proposal, or null (autoOutcomes): taken
/// out again, or its item changed, replaced or removed within 30 days,
/// except by a later source. The one reader of errors: the pauses count
/// them, the stats and the approvals screen explain them.
export async function autoErrors(rows: AutoRow[]): Promise<Map<string, AutoError | null>> {
  return new Map([...(await autoOutcomes(rows))].map(([id, o]) => [id, o.error]));
}

/// Leaves out the clients marked "בלי AI", for a read that Claude gets.
const notAiExcluded: Prisma.KnowledgeProposalWhereInput = { batch: { client: { aiExcluded: false } } };

/// The errors a client's rule counts at `now` (clientPauseDue), from its
/// auto-applied proposals decided by then.
async function clientErrors(clientId: string, now: Date, since: Date | null, opts: { upTo?: boolean; forAi?: boolean } = {}): Promise<AutoError[]> {
  const rows = await prisma.knowledgeProposal.findMany({
    where: {
      clientId,
      autoApplied: true,
      decidedAt: { gte: new Date(now.getTime() - (CLIENT_WINDOW_DAYS + ERROR_WINDOW_DAYS) * DAY), ...(opts.upTo ? { lte: now } : {}) },
      ...(opts.forAi ? notAiExcluded : {}),
    },
    select: AUTO_ROW,
  });
  const errors = [...(await autoErrors(rows)).values()].filter((e): e is AutoError => !!e);
  return clientWindow(errors, now, since);
}

/// What a kind's rule counts (kindPauseDue): its last KIND_WINDOW
/// auto-applied proposals after `since`, each with its error, if any, by
/// `now` when read as of a past moment (`upTo`).
async function kindErrors(key: string, now: Date, since: Date | null, opts: { upTo?: boolean; forAi?: boolean } = {}) {
  const rows = await prisma.knowledgeProposal.findMany({
    where: {
      ...kindWhere(key),
      autoApplied: true,
      decidedAt: { ...(since ? { gt: since } : { not: null }), ...(opts.upTo ? { lte: now } : {}) },
      ...(opts.forAi ? notAiExcluded : {}),
    },
    orderBy: { decidedAt: "desc" },
    take: KIND_WINDOW,
    select: AUTO_ROW,
  });
  const errs = await autoErrors(rows);
  return kindWindow(
    rows.map((r) => {
      const e = errs.get(r.id) ?? null;
      return { decidedAt: r.decidedAt!, error: e && (!opts.upTo || e.at.getTime() <= now.getTime()) ? e : null };
    }),
    since
  );
}

/// When a kind's counters start: the latest guide approval or the latest
/// lift of its pause, whichever is later, as of `at`.
async function kindSince(key: string, at?: Date): Promise<Date | null> {
  const guides = (await guideApprovals()).filter((g) => !at || g.getTime() <= at.getTime());
  const lastGuide = guides.length ? guides[guides.length - 1] : null;
  const lift = await lastLift("KIND", key, at);
  return [lastGuide, lift].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

/// The errors that caused a pause, by the same rule that made it, read
/// as of the moment it began. `forAi` leaves out the clients marked
/// "בלי AI".
export async function pauseErrors(p: { scope: AutoApplyScope; key: string; createdAt: Date }, opts: { forAi?: boolean } = {}): Promise<AutoError[]> {
  if (p.scope === "CLIENT") return clientErrors(p.key, p.createdAt, await lastLift("CLIENT", p.key, p.createdAt), { upTo: true, forAi: opts.forAi });
  const counted = await kindErrors(p.key, p.createdAt, await kindSince(p.key, p.createdAt), { upTo: true, forAi: opts.forAi });
  return counted.flatMap((r) => (r.error ? [r.error] : []));
}

/// pauseErrors, summed up: by type, and the fields that were fixed.
export async function pauseBreakdown(p: { scope: AutoApplyScope; key: string; createdAt: Date }, opts: { forAi?: boolean } = {}): Promise<AutoErrorSummary> {
  return summarizeAutoErrors(await pauseErrors(p, opts));
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

/// The managers' notice is worded per manager, in their own language
/// (ADR 0006, outgoing channels). `reason` is the record, and stays Hebrew.
/// proposalKindLabel (lib/knowledge-review-filters.ts) in the reader's
/// language: a target, or FACT.<kind> for a kind of fact.
function kindLabelIn(t: OutgoingT, key: string): string {
  const [target, factKind] = key.split(".");
  if (factKind && factKind in FACT_KINDS) return t(`labels.factKinds.${factKind as keyof typeof FACT_KINDS}`);
  if (target in TARGETS) return t(`labels.targets.${target as keyof typeof TARGETS}`);
  return key;
}
const TARGETS = { FACT: 1, CONTACT: 1, ORGANIZATION: 1, SYSTEM: 1, REQUEST_TYPE: 1, POLICY: 1, ENTITY: 1, NARRATIVE: 1, PROCESS: 1, DOMAIN: 1, TASK: 1, DATE: 1 } as const;
const FACT_KINDS = { SCOPE_IN: 1, SCOPE_OUT: 1, PREFERENCE: 1, REQUIREMENT: 1, LOCATION: 1, FINANCE: 1, TEMPORARY: 1, ONE_OFF_DECISION: 1, QUESTION: 1, NOTE: 1 } as const;

async function pause(scope: AutoApplyScope, key: string, errors: number, reason: string, notice: (t: OutgoingT) => { title: string; body: string }) {
  // Checked again just before: two arrivals at once pause once.
  const open = await prisma.autoApplyPause.findFirst({ where: { scope, key, liftedAt: null } });
  if (open) return open;
  const row = await prisma.autoApplyPause.create({ data: { scope, key, errors, reason } });
  await recordAudit({ actorId: null, action: "knowledge.auto_apply_pause", entityType: "AutoApplyPause", entityId: row.id, clientId: scope === "CLIENT" ? key : null, after: { scope, key, errors } });
  const to = await managers();
  if (to.length) {
    const words = await outgoingForUsers(to.map((u) => u.id));
    await prisma.notification.createMany({
      data: to.map((u) => {
        const n = notice((words.get(u.id) ?? HEBREW).t);
        return { userId: u.id, type: AUTO_APPLY_PAUSED, title: n.title.slice(0, 200), body: n.body.slice(0, 500), entityType: "Knowledge", entityId: row.id };
      }),
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
    const lift = await lastLift("CLIENT", scope.clientId);
    const errors = (await clientErrors(scope.clientId, now, lift)).map((e) => e.at);
    const due = clientPauseDue(errors, now, lift);
    if (due.due) {
      const client = await prisma.client.findUnique({ where: { id: scope.clientId }, select: { name: true } });
      await pause("CLIENT", scope.clientId, due.errors, `${due.errors} פריטים שנכנסו אוטומטית בוטלו או תוקנו בתוך ${CLIENT_WINDOW_DAYS} יום`, (t) => ({
        title: t("autoApply.clientTitle", { client: client?.name ?? "" }),
        body: t("autoApply.clientBody", { errors: String(due.errors), days: String(CLIENT_WINDOW_DAYS) }),
      }));
      clientPaused = true;
    }
  }

  for (const key of new Set(scope.kindKeys)) {
    if (pausedKinds.has(key)) continue;
    const since = await kindSince(key);
    const counted = await kindErrors(key, now, since);
    const due = kindPauseDue(counted.map((r) => ({ decidedAt: r.decidedAt, error: !!r.error })), since);
    if (!due.due) continue;
    const label = proposalKindLabel(key);
    await pause("KIND", key, due.errors, `${due.errors} מתוך ${due.counted} הפריטים האחרונים מסוג ${label} שנכנסו אוטומטית בוטלו או תוקנו`, (t) => {
      const kind = kindLabelIn(t, key);
      return {
        title: t("autoApply.kindTitle", { kind }),
        body: t("autoApply.kindBody", { errors: String(due.errors), counted: String(due.counted), kind }),
      };
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
  if (done.count === 0) throw new DomainError("autoApply.pauseAlreadyLifted", "העצירה כבר הוסרה.");
  const row = await prisma.autoApplyPause.findUniqueOrThrow({ where: { id } });
  await recordAudit({ actorId: actor.id, action: "knowledge.auto_apply_lift", entityType: "AutoApplyPause", entityId: id, clientId: row.scope === "CLIENT" ? row.key : null, after: { scope: row.scope, key: row.key } });
  return row;
}

/// The switch and the pauses, for the managers on the approvals screen.
/// Beside each pause, the decisions people took on its proposals since it
/// began, one at a time, and how many were approved as they came: the bar
/// for lifting it (30 decisions, a lower bound of 85%) is checked by the
/// manager. With it, what the errors that caused it were (pauseBreakdown).
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
      /// ADR 0006: what the screen words `label` from. The kind's key, or
      /// the client's name (null when the client is gone).
      kindKey: p.scope === "KIND" ? p.key : null,
      clientName: p.scope === "CLIENT" ? (nameOf.get(p.key) ?? null) : null,
      reason: p.reason,
      since: p.createdAt,
      decisions: alone.length,
      approvedAsIs: good,
      lowerBound: wilsonLower(good, alone.length),
      /// 14.11.2026: the errors that caused it, by type and by the fields
      /// that were fixed, so the manager knows what to fix before lifting.
      breakdown: await pauseBreakdown(p),
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
  /// ADR 0006: the kind (proposalKindKey), for a screen in another language.
  kindKey: string;
  headline: string;
  resultId: string | null;
  decidedAt: Date;
  why: string;
  /// `why` as a code with its numbers (autoReviewReasonCode).
  whyCode: NonNullable<ReturnType<typeof autoReviewReasonCode>>;
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
    const ctx = { firstEnabledAt: setting.firstEnabledAt, guideApprovals: guides };
    const why = autoReviewReason({ id: r.id, decidedAt: r.decidedAt }, ctx);
    const whyCode = autoReviewReasonCode({ id: r.id, decidedAt: r.decidedAt }, ctx);
    if (!why || !whyCode) continue;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const target = r.target as ProposalTargetLike;
    out.push({
      id: r.id,
      clientId: r.clientId,
      clientName: nameOf.get(r.clientId) ?? "",
      target,
      kindLabel: proposalKindLabel(proposalKindKey({ target, payload })),
      kindKey: proposalKindKey({ target, payload }),
      headline: proposalHeadline(target, payload),
      resultId: r.resultId,
      decidedAt: r.decidedAt,
      why,
      whyCode,
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
  if (!p) throw new DomainError("autoApply.notFound", "ההצעה לא נמצאה.");
  await assertClientAccess(actor, p.clientId);
  if (!p.autoApplied) throw new DomainError("autoApply.notAutoApplied", "ההצעה לא נכנסה אוטומטית.");
  if (p.revertedAt) throw new DomainError("autoApply.alreadyRemoved", "הפריט כבר הוסר מהתיק.");
  const done = await prisma.knowledgeProposal.updateMany({ where: { id, autoReviewedAt: null }, data: { autoReviewedAt: new Date(), autoReviewedById: actor.id } });
  if (done.count === 0) throw new DomainError("autoApply.alreadyMarked", "כבר סומן כתקין.");
  await recordAudit({ actorId: actor.id, action: "knowledge_proposal.auto_review", entityType: "KnowledgeProposal", entityId: id, clientId: p.clientId });
}
