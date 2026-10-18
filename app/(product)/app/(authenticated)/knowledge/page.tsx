import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { listOpenBatches, proposalQuality } from "@/lib/app-domain/knowledge-proposals";
import { canManageClients } from "@/lib/app-auth/permissions";
import { readSourceRefs, formatSourceRef, SOURCE_KIND_LABELS } from "@/lib/knowledge-sources";
import { DECISION_1_DAYS, firefliesLink, proposalHeadline, qualityLine, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import {
  batchMatches,
  batchUrgent,
  narrowsItems,
  facetCounts,
  parseReviewFilters,
  proposalKindKey,
  proposalKindLabel,
  proposalMatches,
  reviewFiltersHref,
} from "@/lib/knowledge-review-filters";
import { ReviewBatch, type ReviewProposal } from "./ReviewBatch";
import { ReviewFilterBar, type FilterOption } from "./ReviewFilters";

// Org brain, phase 2: "ממתין לאישור" (claude/org-brain-spec-2026-10-12.md,
// 5.2; decision 1). Every proposal Claude sends lands here, one card per
// meeting or document, and nothing reaches a client file until a person
// approves it here. The goal is a normal batch in under five minutes.

export const metadata = { robots: { index: false, follow: false } };

function day(d: Date | null): string | null {
  return d ? new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(d) : null;
}

/// Options for one filter, most first. The label comes from the whole
/// queue, the count from the other filters that are set. An option that
/// would show nothing is left out, unless it is the one chosen, or `keep`
/// says the list is for switching (clients).
function options(labels: Map<string, string>, counts: Map<string, number>, chosen: string[], keep = false): FilterOption[] {
  return [...labels.entries()]
    .map(([value, label]) => ({ value, label, count: counts.get(value) ?? 0 }))
    .filter((o) => keep || o.count > 0 || chosen.includes(o.value))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "he"));
}

export default async function KnowledgeReviewPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReviewFilters(await props.searchParams);
  const user = await requireUser();
  // The whole queue this person can see, filtered here: the counts beside
  // each option come from the queue, not from what is left after filtering,
  // so a person sees what exists without clearing anything.
  const all = await listOpenBatches(user);
  const now = new Date();
  // Decision 1's measure, for whoever makes that decision.
  const quality = canManageClients(user.role) ? qualityLine(await proposalQuality(user, new Date(now.getTime() - DECISION_1_DAYS * 86_400_000)), now) : null;

  const view = all.map((b) => {
    const fireflies =
      b.source && Array.isArray(b.source.externalRefs)
        ? ((b.source.externalRefs as { system?: string; id?: string }[]).find((r) => r?.system === "FIREFLIES")?.id ?? null)
        : null;
    const proposals: ReviewProposal[] = b.proposals.map((p) => {
      const payload = p.payload as Record<string, unknown>;
      const at = readSourceRefs(payload.sources)[0]?.at ?? null;
      return {
        id: p.id,
        target: p.target as ProposalTargetLike,
        action: p.action,
        state: p.state,
        headline: proposalHeadline(p.target as ProposalTargetLike, payload),
        payload,
        sources: readSourceRefs(payload.sources).map(formatSourceRef),
        reason: p.reason,
        quote: p.quote,
        flags: (Array.isArray(p.flags) ? p.flags : []) as { code: string; message: string; block?: boolean }[],
        link: fireflies ? firefliesLink(fireflies, at) : null,
        existing: p.existing ? { body: p.existing.body } : null,
        rejectReason: p.rejectReason,
        hiddenFor: p.hiddenFor,
      };
    });
    return { b, meta: { clientId: b.client.id, sourceKind: b.source?.kind ?? null, createdById: b.createdById, createdAt: b.createdAt }, proposals };
  });

  const clients = new Map<string, string>();
  const kinds = new Map<string, string>();
  const sources = new Map<string, string>();
  const people = new Map<string, string>();
  for (const { b, meta, proposals } of view) {
    if (!proposals.some((p) => p.state === "PENDING")) continue;
    clients.set(meta.clientId, b.client.name);
    if (meta.sourceKind) sources.set(meta.sourceKind, SOURCE_KIND_LABELS[meta.sourceKind]);
    if (meta.createdById) people.set(meta.createdById, b.createdByName ?? "לא ידוע");
    for (const p of proposals) if (p.state === "PENDING") kinds.set(proposalKindKey(p), proposalKindLabel(proposalKindKey(p)));
  }
  const counts = facetCounts(
    view.map((v) => ({ batch: v.meta, proposals: v.proposals })),
    filters,
    now
  );

  const shown = view
    .filter(({ meta }) => batchMatches(meta, filters, now))
    .map((v) => ({ ...v, proposals: v.proposals.filter((p) => proposalMatches(p, filters)) }))
    .filter((v) => v.proposals.some((p) => p.state === "PENDING") || (!narrowsItems(filters) && v.proposals.length > 0))
    // Stable: within each group the query's newest-first order stays.
    .sort((x, y) => Number(batchUrgent(y.proposals)) - Number(batchUrgent(x.proposals)));
  const filtering = narrowsItems(filters);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-appNavy">ממתין לאישור</h1>
        <p className="mt-1 text-sm text-appNavy/60">
          מה ש-Claude הציע לתיקי הלקוחות. שום דבר לא נכנס לתיק לפני שמישהו מאשר אותו כאן.{" "}
          <Link href="/app/extraction-guide" className="text-gold-dim hover:underline">
            הנחיות החילוץ
          </Link>
        </p>
        {quality && (
          <p className={`mt-1.5 text-xs ${quality.tone === "warn" ? "text-warning" : quality.tone === "good" ? "text-success" : "text-appNavy/55"}`} data-testid="proposal-quality">
            {quality.text}
          </p>
        )}
      </div>

      {all.length > 0 && (
        <ReviewFilterBar
          filters={filters}
          clients={options(clients, counts.clients, filters.clientId ? [filters.clientId] : [], true)}
          kinds={options(kinds, counts.kinds, filters.kinds)}
          sources={options(sources, counts.sources, filters.source ? [filters.source] : [])}
          people={options(people, counts.people, filters.by ? [filters.by] : [])}
          attentionCount={counts.attention}
        />
      )}

      {all.length === 0 ? (
        <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">אין הצעות שממתינות לאישור.</div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">
          אין הצעות שמתאימות לסינון.{" "}
          {/* A plain anchor: a document navigation the router cannot drop (see TaskFilters). */}
          <a href={reviewFiltersHref({ clientId: null, kinds: [], attention: false, source: null, by: null, age: null })} className="text-gold-dim hover:underline">
            ניקוי הסינון
          </a>
        </div>
      ) : (
        shown.map(({ b, proposals }) => (
          <ReviewBatch
            key={b.id}
            clientId={b.client.id}
            clientName={b.client.name}
            sourceLabel={b.source ? `${b.source.code} ${b.source.title}` : "בלי מקור"}
            sourceDetails={[b.source ? SOURCE_KIND_LABELS[b.source.kind] : null, b.source ? day(b.source.occurredAt) : null, b.source?.restriction === "TOPICS_ONLY" ? "נושאים בלבד" : null, b.createdByName ? `נשלח על ידי ${b.createdByName}` : null]
              .filter(Boolean)
              .join(" · ")}
            note={b.note}
            droppedCount={Array.isArray(b.dropped) ? b.dropped.length : 0}
            proposals={proposals}
            filtered={filtering}
          />
        ))
      )}
    </div>
  );
}
