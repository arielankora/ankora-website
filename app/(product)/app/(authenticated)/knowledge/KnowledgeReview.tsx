import { knowledgeBatchIsMine } from "@/lib/approvals";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { flagWordsRenderer, type RootT } from "@/lib/knowledge-flag-words";
import { listOpenBatches, proposalQuality } from "@/lib/app-domain/knowledge-proposals";
import { canManageClients } from "@/lib/app-auth/permissions";
import { DECISION_1_DAYS, qualityParts } from "@/lib/knowledge-proposals";
import { listStaffForAssignment } from "@/lib/app-domain/clients";
import {
  batchMatches,
  batchUrgent,
  narrowsItems,
  facetCounts,
  parseReviewFilters,
  proposalKindKey,
  proposalMatches,
  reviewFiltersHref,
} from "@/lib/knowledge-review-filters";
import { ReviewBatch } from "./ReviewBatch";
import { batchHeader, reviewProposals } from "./review-view";
import { ReviewFilterBar, type FilterOption } from "./ReviewFilters";
import { AwaitingAssignmentCard } from "./AwaitingAssignment";
import { listAwaitingAssignment } from "@/lib/app-domain/batch-assignment";
import { autoApplyOverview, listAutoReview } from "@/lib/app-domain/auto-apply";
import { liftBarMet } from "@/lib/auto-apply";
import { fileItemUrl } from "@/lib/approval-links";
import { AutoApplied } from "./AutoApplied";
import { aiExcludedClientIds } from "@/lib/app-domain/ai-exclusion-db";
import { kindKeyLabel, sourceKindLabel } from "./labels";

// Org brain, phase 2: "ממתין לאישור", now the tab "ידע מהחילוץ" of "אישורים" (claude/org-brain-spec-2026-10-12.md,
// 5.2; decision 1). Every proposal Claude sends lands here, one card per
// meeting or document, and nothing reaches a client file until a person
// approves it here. The goal is a normal batch in under five minutes.

/// Options for one filter, most first. The label comes from the whole
/// queue, the count from the other filters that are set. An option that
/// would show nothing is left out, unless it is the one chosen, or `keep`
/// says the list is for switching (clients).
function options(labels: Map<string, string>, counts: Map<string, number>, chosen: string[], locale: string, keep = false): FilterOption[] {
  return [...labels.entries()]
    .map(([value, label]) => ({ value, label, count: counts.get(value) ?? 0 }))
    .filter((o) => keep || o.count > 0 || chosen.includes(o.value))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, locale));
}

/// The review screen as a tab of "אישורים" (20.10.2026). Its own address,
/// /app/knowledge, redirects there with its filters.
export async function KnowledgeReview({ searchParams, mineOnly = false }: { searchParams: Record<string, string | string[] | undefined>; mineOnly?: boolean }) {
  const filters = parseReviewFilters(searchParams);
  const user = await requireUser();
  const [t, format, locale] = await Promise.all([getTranslations("knowledge"), getFormatter(), getLocale()]);
  // The whole queue this person can see, filtered here: the counts beside
  // each option come from the queue, not from what is left after filtering,
  // so a person sees what exists without clearing anything.
  const [queue, awaiting, staff, autoRows, autoControls] = await Promise.all([
    listOpenBatches(user),
    listAwaitingAssignment(user),
    listStaffForAssignment(),
    // 3.11.2026: what entered a file on arrival and still needs a look.
    listAutoReview(user, { clientId: filters.clientId }),
    autoApplyOverview(user),
  ]);
  // ADR 0006: a card or row of a client marked "בלי AI" is kept from the
  // browser's translator.
  const excludedClients = await aiExcludedClientIds([...queue.map((b) => b.client.id), ...autoRows.map((r) => r.clientId)]);
  // 22.10.2026: by default the meetings waiting on this person, whoever
  // sent them or the client's account manager; "של כולם" shows the rest.
  const manager = canManageClients(user.role);
  const all = mineOnly ? queue.filter((b) => knowledgeBatchIsMine({ createdById: b.createdById, accountManagerId: b.client.accountManagerId ?? null }, user.id, manager)) : queue;
  const now = new Date();
  // Decision 1's measure, for whoever makes that decision.
  const qualityNumbers = canManageClients(user.role) ? qualityParts(await proposalQuality(user, new Date(now.getTime() - DECISION_1_DAYS * 86_400_000)), now) : null;
  const quality = qualityNumbers && {
    tone: qualityNumbers.tone,
    text: (() => {
      const q = qualityNumbers;
      if (q.kind === "none") return t("quality.none", { days: String(q.days) });
      const head = t("quality.head", { days: String(q.days), approved: String(q.approved), edited: String(q.edited), pct: String(q.pct), rejected: String(q.rejected) });
      if (q.kind === "firstMonth") return t("quality.firstMonth", { head, date: q.monthEnds ? format.dateTime(q.monthEnds, { day: "numeric", month: "numeric", year: "numeric" }) : "" });
      return q.kind === "good" ? t("quality.good", { head }) : t("quality.warn", { head });
    })(),
  };

  // ADR 0006: the flags' keys reach across the dictionary (a fact's
  // shape under domainErrors, a check under clients.processes).
  const renderFlag = flagWordsRenderer((await getTranslations()) as unknown as RootT);
  const view = all.map((b) => {
    const proposals = reviewProposals(b, renderFlag);
    return { b, meta: { clientId: b.client.id, sourceKind: b.source?.kind ?? null, createdById: b.createdById, createdAt: b.createdAt }, proposals };
  });

  const clients = new Map<string, string>();
  const kinds = new Map<string, string>();
  const sources = new Map<string, string>();
  const people = new Map<string, string>();
  for (const { b, meta, proposals } of view) {
    if (!proposals.some((p) => p.state === "PENDING")) continue;
    clients.set(meta.clientId, b.client.name);
    if (meta.sourceKind) sources.set(meta.sourceKind, sourceKindLabel(t, meta.sourceKind));
    if (meta.createdById) people.set(meta.createdById, b.createdByName ?? t("review.unknownSender"));
    for (const p of proposals) if (p.state === "PENDING") kinds.set(proposalKindKey(p), kindKeyLabel(t, proposalKindKey(p)));
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
        <p className="text-sm text-app-text-secondary">
          {t("review.intro")}{" "}
          <Link href="/app/extraction-guide" className="text-app-text-accent hover:underline">
            {t("review.extractionGuide")}
          </Link>
          {canManageClients(user.role) && (
            <>
              {" · "}
              <Link href="/app/brain-metrics" className="text-app-text-accent hover:underline">
                {t("review.brainMetrics")}
              </Link>
            </>
          )}
        </p>
        {quality && (
          <p className={`mt-1.5 text-xs ${quality.tone === "warn" ? "text-app-warning" : quality.tone === "good" ? "text-app-success" : "text-app-text-secondary"}`} data-testid="proposal-quality">
            {quality.text}
          </p>
        )}
      </div>

      <AutoApplied
        rows={autoRows.map((r) => ({
          id: r.id,
          clientName: r.clientName,
          kindKey: r.kindKey,
          headline: r.headline,
          // A plain path: the screen is on the same site.
          itemHref: r.resultId ? fileItemUrl("", r.clientId, r.resultId) : null,
          enteredAt: r.decidedAt,
          why: r.whyCode,
          aiExcluded: excludedClients.has(r.clientId),
        }))}
        controls={
          autoControls && {
            enabled: autoControls.enabled,
            firstEnabled: autoControls.firstEnabledAt,
            pauses: autoControls.pauses.map((p) => ({
              id: p.id,
              scope: p.scope,
              kindKey: p.kindKey,
              clientName: p.clientName,
              reason: p.reason,
              since: p.since,
              decisions: p.decisions,
              approvedAsIs: p.approvedAsIs,
              lowerBoundPct: Math.floor(p.lowerBound * 100),
              barMet: liftBarMet(p.approvedAsIs, p.decisions),
            })),
          }
        }
      />

      {/* Spec 5.1, step 3: before anything else, since nothing in these can
          be reviewed until a person says whose meeting it was. */}
      {awaiting.map((a) => (
        <AwaitingAssignmentCard
          key={a.id}
          batch={{
            id: a.id,
            sourceLabel: a.source.title,
            sourceDetails: { kind: null, occurredAt: a.source.occurredAt, participants: a.source.participants, topicsOnly: a.source.topicsOnly, sentBy: a.createdByName },
            note: a.note,
            reason: a.reason,
            proposedClientId: a.proposedClientId,
            candidates: a.candidates,
            items: a.itemParts,
            droppedCount: a.droppedCount,
          }}
        />
      ))}

      {all.length > 0 && (
        <ReviewFilterBar
          filters={filters}
          clients={options(clients, counts.clients, filters.clientId ? [filters.clientId] : [], locale, true)}
          kinds={options(kinds, counts.kinds, filters.kinds, locale)}
          sources={options(sources, counts.sources, filters.source ? [filters.source] : [], locale)}
          people={options(people, counts.people, filters.by ? [filters.by] : [], locale)}
          attentionCount={counts.attention}
        />
      )}

      {all.length === 0 ? (
        awaiting.length === 0 && <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">{t("review.empty")}</div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
          {t("review.noMatch")}{" "}
          {/* A plain anchor: a document navigation the router cannot drop (see TaskFilters). */}
          <a href={reviewFiltersHref({ clientId: null, kinds: [], attention: false, source: null, by: null, age: null })} className="text-app-text-accent hover:underline">
            {t("filters.clear")}
          </a>
        </div>
      ) : (
        shown.map(({ b, proposals }) => (
          <ReviewBatch
            key={b.id}
            batchId={b.id}
            clientId={b.client.id}
            clientName={b.client.name}
            {...batchHeader(b)}
            proposals={proposals}
            filtered={filtering}
            staff={staff}
            meId={user.id}
            aiExcluded={excludedClients.has(b.client.id)}
          />
        ))
      )}
    </div>
  );
}
