import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { appBaseUrl } from "@/lib/email-templates";
import { localDateKey } from "@/lib/timezone";
import { decideApproval } from "@/lib/app-domain/decide-approval";
import { decideProposalForAi, findApprovalForAi, listApprovalsForAi, proposalAloneBecause, type ProposalDecision, type ProposalForAi } from "@/lib/app-domain/mcp-approvals";
import { proposalStatsForAi } from "@/lib/app-domain/proposal-stats";
import { APPROVAL_TABS, KIND_LABELS, type ApprovalItem, type ApprovalKind } from "@/lib/approvals";
import { appUrl, approvalRowUrl, autoReviewUrl, batchUrl, fileItemUrl, proposalUrl } from "@/lib/approval-links";
import { listAutoReview } from "@/lib/app-domain/auto-apply";

// "אישורים" from Claude (2.11.2026, Ariel): "as if I were working inside
// the app". Three tools:
//
//   list_approvals             what waits on the person, as the screen
//                              shows it, each row with a direct link and
//                              the decision it offers;
//   decide_approval            approve or reject one row (a task to sign,
//                              an exception, a rule, a procedure, a plan,
//                              a summary, the extraction guide, a process
//                              step, Ankora's own file);
//   decide_knowledge_proposals approve, reject, "already in the file" or
//                              "make it a task" for proposals to a file.
//
// Every decision is taken only on a row that is waiting on this person
// right now (lib/app-domain/mcp-approvals.ts re-reads the list), and goes
// through the same domain function as the button on the screen, with the
// same checks and the same audit row.

const KINDS = APPROVAL_TABS.map((t) => t.key).filter((k): k is ApprovalKind => k !== "all") as [ApprovalKind, ...ApprovalKind[]];

/// Proposals decided in one call. A batch is rarely longer, and each one
/// is a separate decision with its own audit row.
const MAX_PROPOSALS = 25;

function serializeProposal(base: string, p: ProposalForAi) {
  return {
    proposalId: p.id,
    kind: p.kind,
    action: p.action,
    ...(p.hiddenFor
      ? { hidden: `פריט רגיש. רק ${p.hiddenFor} רואה אותו ומחליט עליו.` }
      : {
          says: p.headline,
          why: p.reason,
          quote: p.quote,
          flags: p.flags.length ? p.flags : undefined,
          alreadyInFile: p.alreadyInFile ?? undefined,
          approveAlone: p.aloneBecause ?? undefined,
        }),
    url: proposalUrl(base, p.clientId, p.id),
  };
}

function serializeItem(base: string, i: ApprovalItem, timeZone: string, proposals: ProposalForAi[] | undefined) {
  return {
    kind: i.kind,
    kindLabel: KIND_LABELS[i.kind],
    id: i.id,
    client: i.clientName,
    title: i.title,
    detail: i.detail ?? undefined,
    waitingSince: localDateKey(i.since, timeZone),
    by: i.by ?? undefined,
    recommend: i.recommend ? `${i.recommend.text}${i.recommend.why ? `. ${i.recommend.why}` : ""}` : undefined,
    blocked: i.blocked ?? undefined,
    // What decide_approval can do with it, in the screen's own words.
    // Always present, null when the row has no such button here (a process
    // step fixed on the process, a batch decided proposal by proposal), so
    // "no button" is said rather than left out.
    approve: i.actions.approve ?? null,
    reject: i.actions.reject ? { label: i.actions.reject.label, needsReason: i.actions.reject.note } : null,
    elsewhere: !i.actions.approve && !i.actions.reject && i.kind !== "knowledge" ? (i.go ? `${i.go.label}: ${appUrl(base, i.go.href)}` : "Decided on its own screen; open the link.") : undefined,
    url: approvalRowUrl(base, i),
    // A batch's own place is its card on the review, not the tab.
    openItem: i.kind === "knowledge" && i.clientId ? batchUrl(base, i.clientId, i.id) : appUrl(base, i.href),
    proposals: proposals?.map((p) => serializeProposal(base, p)),
  };
}

export function registerApprovalTools(server: McpServer): void {
  server.registerTool(
    "list_approvals",
    {
      title: "List what waits on my approval",
      description:
        'What waits on the signed-in person\'s decision, as Ankora\'s "אישורים" screen shows it: tasks sent for sign-off, exceptions, rules, procedures, process decisions, Ankora\'s own file, proposals to client files (with each proposal), task plans, monthly summaries, the extraction guide and signed PDFs to check. Each row has its kind and id (pass them to decide_approval), Ankora\'s recommendation and why, `approve` and `reject` (the button\'s label, or null when the row has none here; `reject.needsReason` when rejecting needs a reason), and `url`: a direct link that opens the screen on that very row. Each proposal has its own `proposalId` (for decide_knowledge_proposals) and `url`. `enteredAutomatically` (with no kind, or kind knowledge) lists items that entered a client file on their own and still need a person to look: each with `result` (the item in the file) and `url` (its row, where "תקין" or "ביטול" is pressed; there is no tool for those). Give the user the links as they are; never build one by hand. By default the person\'s own rows; `everyone` adds the meetings other people sent; a client shows all of that client\'s.',
      inputSchema: z.object({
        client: z.string().optional().describe("Only this client, as the user said it."),
        kind: z.enum(KINDS).optional().describe("Only this kind of row."),
        everyone: z.boolean().optional().describe('Also the rows waiting on other people (the screen\'s "של כולם").'),
      }),
      annotations: TOOL_ANNOTATIONS.list_approvals,
    },
    async (args: { client?: string; kind?: ApprovalKind; everyone?: boolean }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        let clientId: string | null = null;
        if (args.client?.trim()) {
          const client = await lookupClient(actor, args.client);
          if (!client.ok) return toolText(client.message);
          clientId = client.value.id;
        }
        const base = appBaseUrl();
        const { items, proposals } = await listApprovalsForAi(actor, { clientId, kind: args.kind ?? null, everyone: args.everyone ?? false });
        const sorted = [...items].sort((a, b) => Number(!!b.blocking) - Number(!!a.blocking) || a.since.getTime() - b.since.getTime());
        // 3.11.2026: what entered a file on arrival and waits for a look.
        const auto = !args.kind || args.kind === "knowledge" ? await listAutoReview(actor, { clientId, forAi: true }) : [];
        return toolJson({
          count: sorted.length,
          screen: appUrl(base, "/app/approvals"),
          approvals: sorted.map((i) => serializeItem(base, i, actor.timezone, proposals.get(i.id))),
          enteredAutomatically: auto.length
            ? auto.map((a) => ({
                proposalId: a.id,
                client: a.clientName,
                kind: a.kindLabel,
                says: a.headline,
                enteredOn: localDateKey(a.decidedAt, actor.timezone),
                why: a.why,
                url: autoReviewUrl(base, a.clientId, a.id),
                result: a.resultId ? fileItemUrl(base, a.clientId, a.resultId) : undefined,
              }))
            : undefined,
        });
      } catch (err) {
        console.error("[mcp] list_approvals failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "decide_approval",
    {
      title: "Approve or reject a row on my approvals",
      description:
        "Carries out the decision on one row from list_approvals, exactly as its button on the screen does: approving a task signs and closes it (rejecting sends it back to work), an exception is approved or rejected, a rule approved or removed, a procedure or a plan approved, a summary approved for the portal or discarded, a guide version approved or rejected, a process decision carried out, Ankora's own items confirmed. Pass `kind` and `id` exactly as list_approvals returned them. A row that is no longer waiting on the user is refused. Proposals to a client file are decided with decide_knowledge_proposals. Before calling, tell the user what the row is and what the decision will do, and call only after they said so: the decision is real and others see it.",
      inputSchema: z.object({
        kind: z.enum(KINDS).describe("The row's kind, from list_approvals."),
        id: z.string().min(1).describe("The row's id, from list_approvals. Never typed or guessed."),
        decision: z.enum(["approve", "reject"]),
        reason: z.string().optional().describe("Why, in a line. Required where the row says `needsReason` (rejecting an exception or a guide version); kept with the decision otherwise where the screen keeps one."),
      }),
      annotations: TOOL_ANNOTATIONS.decide_approval,
    },
    async (args: { kind: ApprovalKind; id: string; decision: "approve" | "reject"; reason?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const base = appBaseUrl();
        if (args.kind === "knowledge") return toolText("Proposals to a client file are decided one by one with decide_knowledge_proposals, by their proposalId from list_approvals.");
        const row = await findApprovalForAi(actor, args.kind, args.id);
        if (!row) return toolText("No row with this kind and id is waiting on you: the id is wrong, it was already decided, or it waits on someone else. Call list_approvals for what waits now. Nothing was changed.");
        const offered = args.decision === "approve" ? row.actions.approve : row.actions.reject?.label;
        if (!offered) {
          const where = row.go ? ` ${row.go.label}: ${appUrl(base, row.go.href)}` : ` Open it: ${appUrl(base, row.href)}`;
          return toolText(`This row has no "${args.decision}" here.${row.blocked ? ` ${row.blocked}` : ""}${where}. Nothing was changed.`);
        }
        if (args.decision === "reject" && row.actions.reject?.note && !args.reason?.trim()) {
          return toolText("Rejecting this needs a reason in a line. Ask the user why, then call again with `reason`. Nothing was changed.");
        }
        await decideApproval(actor, { kind: row.kind, id: row.id, version: row.version, decision: args.decision, note: args.reason, clientId: row.clientId, op: row.op ?? null });
        return toolJson({
          done: true,
          did: offered,
          kind: KIND_LABELS[row.kind],
          title: row.title,
          client: row.clientName,
          url: appUrl(base, row.href),
        });
      } catch (err) {
        console.error("[mcp] decide_approval failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "decide_knowledge_proposals",
    {
      title: "Decide proposals to a client file",
      description:
        'Decides proposals to a client file, each as its own button on the review card: "approve" puts it in the file, "reject" drops it (needs `reason`), "already_in_file" closes it against the item already there and adds its source (only for a proposal list_approvals shows with `alreadyInFile`, as the card offers it only then), "task" opens a task from it instead (assigned to the user, due in three business days). Pass `proposalId`s exactly as list_approvals or propose_knowledge returned them. A proposal marked `approveAlone` (it changes an item in the file, may be a duplicate, or was flagged) is approved only in a call of its own, after the user read it. Each proposal is decided separately: one that fails is reported and the rest go on. Each result has `url` (the proposal on its card), and `result` (the item in the client\'s file) or `task` where the decision made one: give the user those to see the outcome. Before calling, tell the user which proposals and what will happen, and call only after they said so.',
      inputSchema: z.object({
        proposalIds: z.array(z.string().min(1)).min(1).max(MAX_PROPOSALS).describe("The proposals, by proposalId. Never typed or guessed."),
        decision: z.enum(["approve", "reject", "already_in_file", "task"]),
        reason: z.string().optional().describe("Why they are rejected, in a line. Required for reject."),
      }),
      annotations: TOOL_ANNOTATIONS.decide_knowledge_proposals,
    },
    async (args: { proposalIds: string[]; decision: ProposalDecision; reason?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const base = appBaseUrl();
        if (args.decision === "reject" && !args.reason?.trim()) return toolText("Rejecting needs a reason in a line. Ask the user why, then call again with `reason`. Nothing was changed.");
        const ids = [...new Set(args.proposalIds.map((id) => id.trim()).filter(Boolean))];
        const done: { proposalId: string; says: string; url: string; task?: string }[] = [];
        const failed: { proposalId: string; error: string }[] = [];
        for (const id of ids) {
          try {
            if (args.decision === "approve" && ids.length > 1) {
              const alone = await proposalAloneBecause(id);
              if (alone) throw new Error(`Approved only on its own (${alone}). Show it to the user, then call again with this id alone.`);
            }
            const r = await decideProposalForAi(actor, id, args.decision, args.reason ?? null);
            done.push({
              proposalId: id,
              says: r.headline,
              // The proposal on its card. Once every proposal of a batch is
              // decided the card leaves the review, so the result is below.
              url: proposalUrl(base, r.clientId, id),
              ...(r.resultId ? { result: appUrl(base, `/app/clients/${encodeURIComponent(r.clientId)}?tab=file#item-${r.resultId}`) } : {}),
              ...(r.taskId ? { task: appUrl(base, `/app/tasks/${r.taskId}`) } : {}),
            });
          } catch (err) {
            failed.push({ proposalId: id, error: err instanceof Error ? err.message : "Something went wrong." });
          }
        }
        return toolJson({ decision: args.decision, done: done.length, failed: failed.length, results: done, errors: failed.length ? failed : undefined });
      } catch (err) {
        console.error("[mcp] decide_knowledge_proposals failed", err);
        return toolFailure(err);
      }
    }
  );

  // 3.11.2026, Ariel: measure the extraction's history before deciding
  // which kinds of proposals could skip a person (lib/app-domain/proposal-stats.ts).
  server.registerTool(
    "get_proposal_stats",
    {
      title: "Measure how proposals to client files ended",
      description:
        "Managers only. How every proposal to a client file ended, for measuring which kinds are approved as they come and which are edited or rejected: `groups` counts, per kind (a fact's own kind, contact, rule, process, date...) and action (CREATE, SUPERSEDE, CONTRADICT), how many are pending, approved as is, approved after an edit, approved together with others, found already in the file, rejected, or turned into a task. With `rows: true`, one row per proposal with its metadata: source kind, Claude's confidence and the review screen's level, flags, whether it is sensitive, client-visible or carries a \"do not disclose\", why it could not be approved together with others, the outcome and how long the decision took, whether the server approved it with no person (`autoApplied`), whether a person looked at it after and marked it right (`autoReviewed`), whether its item was taken out of the file again (`reverted`), and for a date whether it opens a task before it (`autoTask`). Metadata only: no proposal text, reason, quote or rejection reason is returned, and clients appear as opaque keys (L1, L2...). Proposals of a client marked \"בלי AI\" are left out and only counted. `guideVersions` gives when each version of the extraction guide was approved, to compare periods. `autoApply` says whether auto-apply is on, since when, and which kinds and clients (by key) are paused back to a person. `edited` says only that something was changed before approval, not what.",
      inputSchema: z.object({
        since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only proposals that arrived on or after this day, YYYY-MM-DD. Omit for all of them."),
        via: z.enum(["MCP", "SCREEN"]).optional().describe("MCP: sent by Claude (the extraction). SCREEN: typed on the screen. Omit for both."),
        rows: z.boolean().optional().describe("Also return one row per proposal."),
        limit: z.number().int().min(1).max(500).optional().describe("Rows per call, up to 500 (default 200)."),
        offset: z.number().int().min(0).optional().describe("Rows to skip: the `nextOffset` of the previous call."),
      }),
      annotations: TOOL_ANNOTATIONS.get_proposal_stats,
    },
    async (args: { since?: string; via?: "MCP" | "SCREEN"; rows?: boolean; limit?: number; offset?: number }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const out = await proposalStatsForAi(actor, {
          since: args.since ? new Date(`${args.since}T00:00:00Z`) : null,
          via: args.via ?? null,
          rows: args.rows ?? false,
          limit: args.limit,
          offset: args.offset,
        });
        return toolJson(out);
      } catch (err) {
        console.error("[mcp] get_proposal_stats failed", err);
        return toolFailure(err);
      }
    }
  );
}
