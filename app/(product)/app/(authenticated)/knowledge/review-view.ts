import { readSourceRefs, formatSourceRef, SOURCE_KIND_LABELS } from "@/lib/knowledge-sources";
import { defaultTaskDue, firefliesLink, proposalHeadline, reviewConfidence, reviewRank, taskBlocker, taskFromProposal, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { localDateKey } from "@/lib/timezone";
import type { listOpenBatches } from "@/lib/app-domain/knowledge-proposals";
import type { ReviewProposal } from "./ReviewBatch";

// One batch as the review card reads it, shared by "ממתין לאישור" and the
// client screen's file tab (spec 5.2: one screen for the team, and a tab
// in every client).

export type OpenBatch = Awaited<ReturnType<typeof listOpenBatches>>[number];

function day(d: Date | null): string | null {
  return d ? new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(d) : null;
}

export function reviewProposals(b: OpenBatch): ReviewProposal[] {
  const fireflies =
    b.source && Array.isArray(b.source.externalRefs)
      ? ((b.source.externalRefs as { system?: string; id?: string }[]).find((r) => r?.system === "FIREFLIES")?.id ?? null)
      : null;
  const proposals: ReviewProposal[] = b.proposals.map((p) => {
    const payload = p.payload as Record<string, unknown>;
    const at = readSourceRefs(payload.sources)[0]?.at ?? null;
    const flags = (Array.isArray(p.flags) ? p.flags : []) as ReviewProposal["flags"];
    // Spec 5.2: how sure, as the reviewer should read it, and where it
    // goes on the card.
    const confidence = reviewConfidence({ confidence: p.confidence, flags, payload, at, sourceKind: b.source?.kind ?? null, sourceRestriction: b.source?.restriction ?? null });
    return {
      confidence,
      rank: reviewRank({ action: p.action, flags, payload, level: confidence.level }),
      id: p.id,
      target: p.target as ProposalTargetLike,
      action: p.action,
      state: p.state,
      headline: proposalHeadline(p.target as ProposalTargetLike, payload),
      payload,
      sources: readSourceRefs(payload.sources).map(formatSourceRef),
      reason: p.reason,
      quote: p.quote,
      flags,
      link: fireflies ? firefliesLink(fireflies, at) : null,
      existing: p.existing ? { body: p.existing.body } : null,
      alreadyIn: p.alreadyIn ? { body: p.alreadyIn.body, addsSources: p.alreadyIn.addsSources } : null,
      attached: p.attached,
      rejectReason: p.rejectReason,
      hiddenFor: p.hiddenFor,
      task: {
        ...taskFromProposal({
          target: p.target as ProposalTargetLike,
          payload,
          reason: p.reason,
          quote: p.quote,
          source: b.source ? { code: b.source.code, title: b.source.title } : null,
          link: fireflies ? firefliesLink(fireflies, at) : null,
        }),
        // By when, already filled in: three business days unless changed.
        due: defaultTaskDue(localDateKey(new Date(), "Asia/Jerusalem")),
      },
      taskBlocked: taskBlocker({ target: p.target as ProposalTargetLike, payload }),
      taskId: p.state === "TASK" || (p.state === "APPROVED" && p.target === "TASK") ? p.resultId : null,
    };
  });
  // Pending first, in the order they should be read; decided ones after.
  proposals.sort((x, y) => Number(x.state !== "PENDING") - Number(y.state !== "PENDING") || x.rank - y.rank);
  return proposals;
}

/// The card's header.
export function batchHeader(b: OpenBatch) {
  return {
    sourceLabel: b.source ? `${b.source.code} ${b.source.title}` : "בלי מקור",
    sourceDetails: [b.source ? SOURCE_KIND_LABELS[b.source.kind] : null, b.source ? day(b.source.occurredAt) : null, b.source?.restriction === "TOPICS_ONLY" ? "נושאים בלבד" : null, b.createdByName ? `נשלח על ידי ${b.createdByName}` : null]
      .filter(Boolean)
      .join(" · "),
    note: b.note,
    droppedCount: Array.isArray(b.dropped) ? b.dropped.length : 0,
  };
}
