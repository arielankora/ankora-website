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
import { APPROVAL_TABS, KIND_LABELS, type ApprovalItem, type ApprovalKind } from "@/lib/approvals";
import { appUrl, approvalRowUrl, batchUrl, proposalUrl } from "@/lib/approval-links";

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
      ? { hidden: `Sensitive. Only ${p.hiddenFor} may read and decide it.` }
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
    approve: i.actions.approve ?? undefined,
    reject: i.actions.reject ? { label: i.actions.reject.label, needsReason: i.actions.reject.note } : undefined,
    elsewhere: !i.actions.approve && !i.actions.reject && i.kind !== "knowledge" ? (i.go ? `${i.go.label}: ${appUrl(base, i.go.href)}` : "Decided on its own screen; open the link.") : undefined,
    url: approvalRowUrl(base, i),
    openItem: appUrl(base, i.href),
    proposals: proposals?.map((p) => serializeProposal(base, p)),
  };
}

export function registerApprovalTools(server: McpServer): void {
  server.registerTool(
    "list_approvals",
    {
      title: "List what waits on my approval",
      description:
        'What waits on the signed-in person\'s decision, as Ankora\'s "אישורים" screen shows it: tasks sent for sign-off, exceptions, rules, procedures, process decisions, Ankora\'s own file, proposals to client files (with each proposal), task plans, monthly summaries, the extraction guide and signed PDFs to check. Each row has its kind and id (pass them to decide_approval), Ankora\'s recommendation and why, what approving and rejecting do, and `url`: a direct link that opens the screen on that very row. Each proposal has its own `proposalId` (for decide_knowledge_proposals) and `url`. Give the user the links as they are; never build one by hand. By default the person\'s own rows; `everyone` adds the meetings other people sent; a client shows all of that client\'s.',
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
        return toolJson({
          count: sorted.length,
          screen: appUrl(base, "/app/approvals"),
          approvals: sorted.map((i) => serializeItem(base, i, actor.timezone, proposals.get(i.id))),
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
        if (!row) return toolText("That row is not waiting on you now: it was decided already, or it is not yours to decide. Call list_approvals for what waits. Nothing was changed.");
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
        'Decides proposals to a client file, each as its own button on the review card: "approve" puts it in the file, "reject" drops it (needs `reason`), "already_in_file" closes it against the item already there and adds its source, "task" opens a task from it instead (assigned to the user, due in three business days). Pass `proposalId`s exactly as list_approvals or propose_knowledge returned them. A proposal marked `approveAlone` (it changes an item in the file, may be a duplicate, or was flagged) is approved only in a call of its own, after the user read it. Each proposal is decided separately: one that fails is reported and the rest go on. Before calling, tell the user which proposals and what will happen, and call only after they said so.',
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
            done.push({ proposalId: id, says: r.headline, url: batchUrl(base, r.clientId, r.batchId), ...(r.taskId ? { task: appUrl(base, `/app/tasks/${r.taskId}`) } : {}) });
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
}
