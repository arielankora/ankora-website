import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { readSourceRefs } from "@/lib/knowledge-sources";
import { bulkApproveBlocker, reviewConfidence, type ProposalFlag, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { proposalKindKey } from "@/lib/knowledge-review-filters";
import { activePauses, autoApplySetting } from "@/lib/app-domain/auto-apply";
import { readEditKind, type ProposalEditKind } from "@/lib/proposal-edits";

// 3.11.2026, Ariel: "לצמצם את ההצעות מהחילוץ שמחכות לאישור מנהל תיק, לפי
// רמת סיכון וודאות". To decide which kinds of proposals could enter a file
// without a person, the history has to be measured first: of each kind,
// how many were approved as they came, edited, rejected, or found already
// in the file. This is the read behind get_proposal_stats.
//
// Metadata only. A proposal's payload, reason and quote are a client's
// own information, and the measure needs none of it: the payload is read
// here for a few yes/no facts (sensitive, client-visible, "do not
// disclose", uncertain, has a recording minute, a date that opens a task)
// and nothing of it is returned. Clients are named by an opaque key (L1,
// L2...), so the numbers can be quoted in a task comment without naming
// anyone.
// "בלי AI": a marked client's proposals are left out, and only counted.
//
// What was edited (3.11.2026, lib/proposal-edits.ts): the names of the
// fields a person changed (`editedFields`), and whether the change was to
// the wording or to a fact (`editKind`, from the audit row of the
// approval). Names and a kind only, never the values. Proposals approved
// before then have `edited` and no fields.

export type ProposalStatRow = {
  id: string;
  client: string;
  kind: string;
  target: string;
  action: string;
  via: string;
  sourceKind: string | null;
  sourceRestriction: string | null;
  /// What Claude said, and what the review screen showed (lowered for
  /// what it can see).
  confidence: string | null;
  reviewLevel: string;
  knowledgeStatus: string | null;
  sensitive: boolean;
  clientVisible: boolean;
  doNotDisclose: boolean;
  /// Why the review screen would not approve it together with others.
  aloneBecause: string | null;
  flags: string[];
  blocked: boolean;
  state: string;
  edited: boolean;
  /// The payload fields changed before approval, names only.
  editedFields: string[];
  /// WORDING, FACT, or MIXED (both), from the approval's audit row; null
  /// when nothing was changed or the approval predates it.
  editKind: ProposalEditKind | null;
  attached: boolean;
  /// 3.11.2026, the approval tiers: approved by the server with no person,
  /// and whether its item was taken out of the file again ("ביטול").
  autoApplied: boolean;
  reverted: boolean;
  /// Auto-applied, and a person looked at it after and marked it right ("תקין").
  autoReviewed: boolean;
  /// A date only: whether it opens a task before it (taskDaysBefore).
  autoTask?: boolean;
  /// Approved or rejected together with others, by the audit row.
  bulk: boolean;
  rejected: boolean;
  createdAt: string;
  decidedAt: string | null;
  /// Hours from arriving to the decision.
  hoursToDecision: number | null;
};

export type ProposalStatGroup = {
  kind: string;
  action: string;
  total: number;
  pending: number;
  approvedAsIs: number;
  approvedEdited: number;
  approvedInBulk: number;
  alreadyInFile: number;
  rejected: number;
  toTask: number;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function bool(v: unknown): boolean {
  return v === true || (typeof v === "string" && v.trim().length > 0);
}

export async function proposalStatsForAi(
  actor: User,
  opts: { since?: Date | null; via?: "MCP" | "SCREEN" | null; rows?: boolean; limit?: number; offset?: number } = {}
) {
  if (!canManageClients(actor.role)) throw new Error("רק למנהלים.");

  // A proposal reaches its client through its batch.
  const where = (aiExcluded: boolean) => ({
    ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
    batch: { ...(opts.via ? { via: opts.via } : {}), client: { aiExcluded } },
  });
  const [proposals, excludedCount, guides] = await Promise.all([
    prisma.knowledgeProposal.findMany({
      where: where(false),
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        clientId: true,
        target: true,
        action: true,
        payload: true,
        confidence: true,
        flags: true,
        state: true,
        edited: true,
        editedFields: true,
        attached: true,
        autoApplied: true,
        revertedAt: true,
        autoReviewedAt: true,
        createdAt: true,
        decidedAt: true,
        batch: { select: { via: true, sourceId: true } },
      },
    }),
    prisma.knowledgeProposal.count({ where: where(true) }),
    prisma.extractionGuide.findMany({
      where: { state: "APPROVED" },
      orderBy: { version: "asc" },
      select: { version: true, decidedAt: true, createdAt: true },
    }),
  ]);

  const sourceIds = [...new Set(proposals.flatMap((p) => (p.batch.sourceId ? [p.batch.sourceId] : [])))];
  const ids = proposals.map((p) => p.id);
  const [sources, audits] = await Promise.all([
    sourceIds.length
      ? prisma.clientSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, kind: true, restriction: true } })
      : Promise.resolve([]),
    ids.length
      ? prisma.auditEvent.findMany({
          where: { entityType: "KnowledgeProposal", entityId: { in: ids }, action: { in: ["knowledge_proposal.approve", "knowledge_proposal.reject"] } },
          select: { entityId: true, afterJson: true },
        })
      : Promise.resolve([]),
  ]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const bulkIds = new Set(audits.filter((a) => (a.afterJson as { bulk?: unknown } | null)?.bulk === true).map((a) => a.entityId));
  const editKinds = new Map(audits.flatMap((a) => {
    const kind = readEditKind((a.afterJson as { editKind?: unknown } | null)?.editKind);
    return kind && a.entityId ? [[a.entityId, kind] as const] : [];
  }));

  const clientKey = new Map<string, string>();
  const keyOf = (id: string) => {
    if (!clientKey.has(id)) clientKey.set(id, `L${clientKey.size + 1}`);
    return clientKey.get(id)!;
  };

  const all: ProposalStatRow[] = proposals.map((p) => {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    const flags = (Array.isArray(p.flags) ? p.flags : []) as ProposalFlag[];
    const source = p.batch.sourceId ? sourceById.get(p.batch.sourceId) : undefined;
    const at = readSourceRefs(payload.sources)[0]?.at ?? null;
    const level = reviewConfidence({ confidence: p.confidence, flags, payload, at, sourceKind: source?.kind ?? null, sourceRestriction: source?.restriction ?? null }).level;
    return {
      id: p.id,
      client: keyOf(p.clientId),
      kind: proposalKindKey({ target: p.target as ProposalTargetLike, payload }),
      target: p.target,
      action: p.action,
      via: p.batch.via,
      sourceKind: source?.kind ?? null,
      sourceRestriction: source?.restriction ?? null,
      confidence: p.confidence,
      reviewLevel: level,
      knowledgeStatus: typeof payload.knowledgeStatus === "string" ? payload.knowledgeStatus : null,
      sensitive: payload.sensitivity === "SENSITIVE",
      clientVisible: payload.clientVisible === true,
      doNotDisclose: bool(payload.doNotDisclose),
      aloneBecause: bulkApproveBlocker({ target: p.target as ProposalTargetLike, action: p.action, flags, payload, level }),
      flags: [...new Set(flags.map((f) => f.code))],
      blocked: flags.some((f) => f.block),
      state: p.state,
      edited: p.edited,
      editedFields: p.editedFields ?? [],
      editKind: p.edited ? (editKinds.get(p.id) ?? null) : null,
      attached: p.attached,
      autoApplied: p.autoApplied,
      reverted: p.revertedAt !== null,
      autoReviewed: p.autoReviewedAt !== null,
      ...(p.target === "DATE" ? { autoTask: payload.taskDaysBefore != null } : {}),
      bulk: bulkIds.has(p.id),
      rejected: p.state === "REJECTED",
      createdAt: p.createdAt.toISOString(),
      decidedAt: iso(p.decidedAt),
      hoursToDecision: p.decidedAt ? Math.round(((p.decidedAt.getTime() - p.createdAt.getTime()) / 3_600_000) * 10) / 10 : null,
    };
  });

  const groups = new Map<string, ProposalStatGroup>();
  for (const r of all) {
    const key = `${r.kind}|${r.action}`;
    const g = groups.get(key) ?? { kind: r.kind, action: r.action, total: 0, pending: 0, approvedAsIs: 0, approvedEdited: 0, approvedInBulk: 0, alreadyInFile: 0, rejected: 0, toTask: 0 };
    g.total++;
    if (r.state === "PENDING") g.pending++;
    else if (r.state === "REJECTED") g.rejected++;
    else if (r.state === "TASK") g.toTask++;
    else if (r.attached) g.alreadyInFile++;
    else if (r.edited) g.approvedEdited++;
    else g.approvedAsIs++;
    if (r.state === "APPROVED" && r.bulk) g.approvedInBulk++;
    groups.set(key, g);
  }

  // 3.11.2026, approval tiers part 2: the switch and what is paused. A
  // paused client is named by its opaque key, as in the rows.
  const [setting, pauses] = await Promise.all([autoApplySetting(), activePauses()]);
  const autoApply = {
    enabled: setting.enabled,
    firstEnabledAt: iso(setting.firstEnabledAt),
    pauses: pauses.map((p) => ({ scope: p.scope, key: p.scope === "CLIENT" ? keyOf(p.key) : p.key, errors: p.errors, since: p.createdAt.toISOString() })),
  };

  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  return {
    total: all.length,
    clients: clientKey.size,
    leftOutAiExcluded: excludedCount,
    firstAt: all[0]?.createdAt ?? null,
    lastAt: all.at(-1)?.createdAt ?? null,
    guideVersions: guides.map((g) => ({ version: g.version, approvedAt: iso(g.decidedAt ?? g.createdAt) })),
    autoApply,
    groups: [...groups.values()].sort((a, b) => b.total - a.total),
    rows: opts.rows ? all.slice(offset, offset + limit) : undefined,
    nextOffset: opts.rows && offset + limit < all.length ? offset + limit : undefined,
  };
}
