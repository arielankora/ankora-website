import type { useTranslations } from "next-intl";
import { FACT_KIND_LABELS, type FactKindLike } from "@/lib/client-facts";
import { POLICY_KIND_LABELS, type PolicyKindLike } from "@/lib/client-policies";
import { SOURCE_KIND_LABELS, type SourceKindLike } from "@/lib/knowledge-sources";
import { NARRATIVE_KIND_LABELS, TARGET_LABELS, type DetailPart, type ProposalTargetLike } from "@/lib/knowledge-proposals";

// ADR 0006: the review screen's words for the codes the domain keeps
// (kinds, sources, details), in the reader's language. The Hebrew maps in
// lib/ stay as they are for Claude, documents and the screens not yet
// translated; these only read them to know which codes exist.

export type KnowledgeT = ReturnType<typeof useTranslations<"knowledge">>;

const isFactKind = (k: unknown): k is FactKindLike => typeof k === "string" && k in FACT_KIND_LABELS;
const isPolicyKind = (k: unknown): k is PolicyKindLike => typeof k === "string" && k in POLICY_KIND_LABELS;
const isNarrativeKind = (k: unknown): k is keyof typeof NARRATIVE_KIND_LABELS => typeof k === "string" && k in NARRATIVE_KIND_LABELS;
const isTarget = (k: unknown): k is ProposalTargetLike => typeof k === "string" && k in TARGET_LABELS;
export const isSourceKind = (k: unknown): k is SourceKindLike => typeof k === "string" && k in SOURCE_KIND_LABELS;

/// The kind of item, as the reviewer reads it: a fact by its kind, a rule
/// by its kind, a free text by which one, everything else by what it is.
export function targetLabel(t: KnowledgeT, p: { target: ProposalTargetLike; payload: Record<string, unknown> }): string {
  if (p.target === "FACT" && p.payload.kind) return isFactKind(p.payload.kind) ? t(`factKinds.${p.payload.kind}`) : "";
  if (p.target === "POLICY" && p.payload.kind) return t("policyKind", { kind: isPolicyKind(p.payload.kind) ? t(`policyKinds.${p.payload.kind}`) : "" });
  if (p.target === "NARRATIVE" && p.payload.kind) return isNarrativeKind(p.payload.kind) ? t(`narrativeKinds.${p.payload.kind}`) : t("targets.NARRATIVE");
  return t(`targets.${p.target}`);
}

/// A filter's kind key (lib/knowledge-review-filters.ts, proposalKindKey):
/// "FACT.FINANCE" or a target. Unknown keys read as themselves.
export function kindKeyLabel(t: KnowledgeT, key: string): string {
  if (key.startsWith("FACT.")) {
    const kind = key.slice(5);
    return isFactKind(kind) ? t(`factKinds.${kind}`) : t("targets.FACT");
  }
  return isTarget(key) ? t(`targets.${key}`) : key;
}

export function sourceKindLabel(t: KnowledgeT, kind: string): string {
  return isSourceKind(kind) ? t(`sourceKinds.${kind}`) : kind;
}

/// One line of a proposal's details (lib/knowledge-proposals.ts,
/// proposalDetailParts). Text people or Claude wrote is shown as it is.
export function detailLine(t: KnowledgeT, part: DetailPart, formatAmount: (n: number) => string): string {
  switch (part.kind) {
    case "text":
      return part.text;
    case "key":
      return t(`details.${part.key}`, part.values ?? {});
    case "priority":
      return t("details.priority", {
        priority: part.priority === "LOW" || part.priority === "HIGH" || part.priority === "URGENT" || part.priority === "NORMAL" ? t(`priority.${part.priority}`) : part.priority,
      });
    case "billing": {
      const cycle = part.cycle === "MONTHLY" || part.cycle === "ANNUAL" || part.cycle === "OTHER" ? t(`billingCycle.${part.cycle}`) : "";
      const cost = part.amount !== null ? `${formatAmount(part.amount)} ${part.currency}`.trim() : "";
      const card = part.cardLast4 ? t("details.card", { last4: part.cardLast4 }) : "";
      return t("details.billing", { details: [cycle, cost, card].filter(Boolean).join(", ") });
    }
    case "step":
      return `${part.n}. ${part.title}${part.requiresApproval ? ` ${t("details.requiresApproval")}` : ""}${part.systems.length ? ` [${part.systems.join(", ")}]` : ""}`;
  }
}
