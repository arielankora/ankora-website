import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { collectApprovals } from "@/lib/app-domain/approvals";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { aiExcludedClientIds, aiExcludedTaskIds } from "@/lib/app-domain/ai-exclusion-db";
import { approveProposal, attachProposalToExisting, listOpenBatches, proposalToTask, rejectProposal } from "@/lib/app-domain/knowledge-proposals";
import { onlyMine, type ApprovalItem, type ApprovalKind } from "@/lib/approvals";
import { bulkApproveBlocker, proposalHeadline, type ProposalFlag, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { proposalKindKey, proposalKindLabel } from "@/lib/knowledge-review-filters";
import { AI_EXCLUDED_TOOL_MESSAGE } from "@/lib/ai-exclusion";

// "אישורים" for Claude (2.11.2026): what waits on the signed-in person,
// and the decisions themselves, so a person can work their approvals from
// a conversation as they would on the screen. The tools are in
// lib/mcp/approval-tools.ts; the reads and the checks are here.
//
// Read from collectApprovals, the same list the screen shows, so Claude
// is offered exactly the rows the screen offers and a decision is only
// ever taken on a row that is waiting on this person right now.
// "בלי AI": rows of a marked client, and of a marked task, are left out.

/// A row's kinds that are tasks by id: a task to sign, a task's plan.
const TASK_KINDS: ApprovalKind[] = ["task", "plan"];

async function withoutAiExcluded(items: ApprovalItem[]): Promise<ApprovalItem[]> {
  const [clients, tasks] = await Promise.all([
    aiExcludedClientIds(items.flatMap((i) => (i.clientId ? [i.clientId] : []))),
    aiExcludedTaskIds(items.filter((i) => TASK_KINDS.includes(i.kind)).map((i) => i.id)),
  ]);
  return items.filter((i) => !(i.clientId && clients.has(i.clientId)) && !(TASK_KINDS.includes(i.kind) && tasks.has(i.id)));
}

export type ProposalForAi = {
  id: string;
  batchId: string;
  clientId: string;
  kind: string;
  action: string;
  headline: string | null;
  reason: string | null;
  quote: string | null;
  flags: string[];
  /// Why it is approved on its own, never with others.
  aloneBecause: string | null;
  alreadyInFile: string | null;
  /// A sensitive proposal this person may not read: who decides it.
  hiddenFor: string | null;
};

/// Every row waiting on this person, as on the screen: their own by
/// default, everyone's with `everyone`, all of one client's with a client.
export async function listApprovalsForAi(
  actor: User,
  options: { clientId?: string | null; kind?: ApprovalKind | null; everyone?: boolean } = {}
): Promise<{ items: ApprovalItem[]; proposals: Map<string, ProposalForAi[]> }> {
  const all = await collectApprovals(actor);
  let items = options.clientId ? all.filter((i) => i.clientId === options.clientId) : options.everyone ? all : onlyMine(all);
  if (options.kind) items = items.filter((i) => i.kind === options.kind);
  items = await withoutAiExcluded(items);

  const proposals = new Map<string, ProposalForAi[]>();
  const batchIds = new Set(items.filter((i) => i.kind === "knowledge").map((i) => i.id));
  if (batchIds.size > 0) {
    const clientIds = new Set(items.filter((i) => i.kind === "knowledge").map((i) => i.clientId));
    const batches = await listOpenBatches(actor, clientIds.size === 1 ? { clientId: [...clientIds][0] ?? undefined } : {});
    for (const b of batches) {
      if (!batchIds.has(b.id)) continue;
      proposals.set(
        b.id,
        b.proposals
          .filter((p) => p.state === "PENDING")
          .map((p) => {
            const payload = (p.payload ?? {}) as Record<string, unknown>;
            const flags = (Array.isArray(p.flags) ? p.flags : []) as ProposalFlag[];
            const target = p.target as ProposalTargetLike;
            if (p.hiddenFor) {
              return { id: p.id, batchId: b.id, clientId: b.clientId, kind: proposalKindLabel(proposalKindKey({ target, payload })), action: p.action, headline: null, reason: null, quote: null, flags: [], aloneBecause: "פריט רגיש", alreadyInFile: null, hiddenFor: p.hiddenFor };
            }
            return {
              id: p.id,
              batchId: b.id,
              clientId: b.clientId,
              kind: proposalKindLabel(proposalKindKey({ target, payload })),
              action: p.action,
              headline: proposalHeadline(target, payload),
              reason: p.reason,
              quote: p.quote,
              flags: flags.map((f) => f.message),
              aloneBecause: bulkApproveBlocker({ action: p.action, flags, payload }),
              alreadyInFile: p.alreadyIn?.body ?? null,
              hiddenFor: null,
            };
          })
      );
    }
  }
  return { items, proposals };
}

/// One row, by the kind and id list_approvals gave, only while it is
/// still waiting on this person. Null when it is not (decided already,
/// someone else's, or never was).
export async function findApprovalForAi(actor: User, kind: ApprovalKind, id: string): Promise<ApprovalItem | null> {
  const row = (await collectApprovals(actor)).find((i) => i.kind === kind && i.id === id);
  if (!row) return null;
  const [kept] = await withoutAiExcluded([row]);
  return kept ?? null;
}

export type ProposalDecision = "approve" | "reject" | "already_in_file" | "task";

/// One proposal decided, as one click on its card. The domain functions
/// check access, sensitivity and what blocks approval; this adds "בלי AI"
/// and says where the result is.
export async function decideProposalForAi(
  actor: User,
  id: string,
  decision: ProposalDecision,
  reason: string | null
): Promise<{ clientId: string; batchId: string; headline: string; taskId: string | null; resultId: string | null }> {
  const p = await prisma.knowledgeProposal.findUnique({ where: { id }, select: { clientId: true, batchId: true, target: true, payload: true } });
  const accessible = p ? (await listAccessibleClients(actor)).some((c) => c.id === p.clientId) : false;
  if (!p || !accessible) throw new Error("No proposal with this id is waiting for you. Call list_approvals for the current ones.");
  if ((await aiExcludedClientIds([p.clientId])).size > 0) throw new Error(AI_EXCLUDED_TOOL_MESSAGE);
  const headline = proposalHeadline(p.target as ProposalTargetLike, (p.payload ?? {}) as Record<string, unknown>);
  // Where the decision landed (2.11.2026): the item in the file, or the
  // task it opened, so the person can see the result, not only the card.
  let taskId: string | null = null;
  let resultId: string | null = null;
  switch (decision) {
    case "approve": {
      const r = await approveProposal(actor, id);
      if (p.target === "TASK") taskId = r.resultId ?? null;
      else resultId = r.resultId ?? null;
      break;
    }
    case "reject":
      await rejectProposal(actor, id, reason ?? "");
      break;
    case "already_in_file":
      resultId = (await attachProposalToExisting(actor, id)).resultId ?? null;
      break;
    case "task":
      taskId = (await proposalToTask(actor, id)).taskId;
      break;
  }
  return { clientId: p.clientId, batchId: p.batchId, headline, taskId, resultId };
}

/// Whether a proposal must be approved on its own (bulkApproveBlocker), as
/// the card says it: a change to an item already in the file, a possible
/// duplicate, something flagged. Null when it may go with others.
export async function proposalAloneBecause(id: string): Promise<string | null> {
  const p = await prisma.knowledgeProposal.findUnique({ where: { id }, select: { action: true, flags: true, payload: true } });
  if (!p) return null;
  return bulkApproveBlocker({ action: p.action, flags: (Array.isArray(p.flags) ? p.flags : []) as ProposalFlag[], payload: (p.payload ?? {}) as Record<string, unknown> });
}
