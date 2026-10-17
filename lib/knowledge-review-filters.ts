// Filters on the review screen, "ממתין לאישור"
// (claude/knowledge-review-filters-spec-2026-10-17.md).
//
// Pure, so the server page that filters and the bar that shows the
// choices agree on one definition of "kind" and "needs attention".
// The filter lives in the URL: a link can be sent, a reload keeps it.

import { FACT_KIND_LABELS, type FactKindLike } from "@/lib/client-facts";
import { TARGET_LABELS, bulkApproveBlocker, type ProposalActionLike, type ProposalFlag, type ProposalTargetLike } from "@/lib/knowledge-proposals";

export type ReviewFilters = {
  clientId: string | null;
  /// OR between kinds. Empty means every kind.
  kinds: string[];
  attention: boolean;
  source: string | null;
  by: string | null;
  /// Waiting longer than this many days.
  age: number | null;
};

export const AGE_OPTIONS = [3, 7] as const;

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : null;
}

function many(v: string | string[] | undefined): string[] {
  const all = Array.isArray(v) ? v : v ? [v] : [];
  return [...new Set(all.map((s) => s.trim()).filter(Boolean))];
}

export function parseReviewFilters(params: Params): ReviewFilters {
  const age = Number(one(params.age));
  return {
    clientId: one(params.clientId),
    kinds: many(params.kind),
    attention: one(params.attention) === "1",
    source: one(params.source),
    by: one(params.by),
    age: (AGE_OPTIONS as readonly number[]).includes(age) ? age : null,
  };
}

/// Any filter other than the client. The client alone keeps the screen as
/// it was before filters: decided rows still show in their batch.
export function narrowsItems(f: ReviewFilters): boolean {
  return f.kinds.length > 0 || f.attention || !!f.source || !!f.by || f.age !== null;
}

export function reviewFiltersHref(f: ReviewFilters): string {
  const q = new URLSearchParams();
  if (f.clientId) q.set("clientId", f.clientId);
  for (const k of f.kinds) q.append("kind", k);
  if (f.attention) q.set("attention", "1");
  if (f.source) q.set("source", f.source);
  if (f.by) q.set("by", f.by);
  if (f.age !== null) q.set("age", String(f.age));
  const s = q.toString();
  return s ? `/app/knowledge?${s}` : "/app/knowledge";
}

type KindLike = { target: ProposalTargetLike; payload: Record<string, unknown> };

/// A fact by its kind (כספים, מיקום...), everything else by what it is.
export function proposalKindKey(p: KindLike): string {
  if (p.target === "FACT" && typeof p.payload.kind === "string" && p.payload.kind in FACT_KIND_LABELS) return `FACT.${p.payload.kind}`;
  return p.target;
}

export function proposalKindLabel(key: string): string {
  if (key.startsWith("FACT.")) return FACT_KIND_LABELS[key.slice(5) as FactKindLike] ?? TARGET_LABELS.FACT;
  return TARGET_LABELS[key as ProposalTargetLike] ?? key;
}

type AttentionLike = KindLike & { action: ProposalActionLike; flags: ProposalFlag[]; hiddenFor: string | null };

/// What a person should look at closely: what is approved one at a time
/// (a change, a possible duplicate, sensitive), anything a rule flagged,
/// and a sensitive item waiting for someone else.
export function needsAttention(p: AttentionLike): boolean {
  return !!p.hiddenFor || p.flags.length > 0 || !!bulkApproveBlocker(p);
}

export type FilterableBatch = { clientId: string; sourceKind: string | null; createdById: string | null; createdAt: Date };
type FilterableProposal = AttentionLike & { state: string };

const DAY = 24 * 60 * 60 * 1000;

export function batchMatches(b: FilterableBatch, f: ReviewFilters, now: Date): boolean {
  if (f.clientId && b.clientId !== f.clientId) return false;
  if (f.source && b.sourceKind !== f.source) return false;
  if (f.by && b.createdById !== f.by) return false;
  if (f.age !== null && now.getTime() - b.createdAt.getTime() < f.age * DAY) return false;
  return true;
}

export function proposalMatches(p: FilterableProposal, f: ReviewFilters): boolean {
  if (p.state !== "PENDING") return !narrowsItems(f);
  if (f.kinds.length > 0 && !f.kinds.includes(proposalKindKey(p))) return false;
  if (f.attention && !needsAttention(p)) return false;
  return true;
}

/// Batches with something that needs a person, or a temporary fact that
/// loses its value while it waits, come first. Then newest first. The
/// rows inside a batch keep the order of the meeting.
export function batchUrgent(proposals: FilterableProposal[]): boolean {
  return proposals.some((p) => p.state === "PENDING" && (needsAttention(p) || proposalKindKey(p) === "FACT.TEMPORARY"));
}

export type FacetCounts = {
  clients: Map<string, number>;
  kinds: Map<string, number>;
  sources: Map<string, number>;
  people: Map<string, number>;
  attention: number;
};

/// How many pending proposals each option would show, given every other
/// filter that is set. Choosing a client updates the kind counts, choosing
/// a kind updates the client counts, and so on. A facet never narrows its
/// own counts: with "כספים" chosen, "איש קשר" still says how many it would
/// add.
export function facetCounts(items: { batch: FilterableBatch; proposals: FilterableProposal[] }[], f: ReviewFilters, now: Date): FacetCounts {
  const out: FacetCounts = { clients: new Map(), kinds: new Map(), sources: new Map(), people: new Map(), attention: 0 };
  const bump = (m: Map<string, number>, k: string | null) => {
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  };
  const without = {
    client: { ...f, clientId: null },
    kind: { ...f, kinds: [] },
    attention: { ...f, attention: false },
    source: { ...f, source: null },
    by: { ...f, by: null },
  };
  for (const { batch, proposals } of items) {
    for (const p of proposals) {
      if (p.state !== "PENDING") continue;
      const ok = (g: ReviewFilters) => batchMatches(batch, g, now) && proposalMatches(p, g);
      if (ok(without.client)) bump(out.clients, batch.clientId);
      if (ok(without.kind)) bump(out.kinds, proposalKindKey(p));
      if (ok(without.source)) bump(out.sources, batch.sourceKind);
      if (ok(without.by)) bump(out.people, batch.createdById);
      if (ok(without.attention) && needsAttention(p)) out.attention += 1;
    }
  }
  return out;
}
