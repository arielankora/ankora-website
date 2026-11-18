import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson } from "@/lib/mcp/errors";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { appBaseUrl } from "@/lib/email-templates";
import { getClaudeUsageReport } from "@/lib/app-domain/claude-usage";
import { FIELD_NOTES_SENTENCE, withFieldNotes } from "@/lib/mcp/field-notes";
import { CLAUDE_USAGE_NOTES } from "@/lib/mcp/tool-field-notes";

// Claude usage measurement, stage 3 (17.11.2026): get_claude_usage. The
// same report as the "שימוש בקלוד" screen, for the weekly usage report and
// for a manager who asks Claude where the allowance goes. SUPER_ADMIN only;
// anyone else gets the domain's refusal in its own words.
//
// Nothing here is a client's data: names of staff, sizes, counts and
// Cowork's cost estimates. The settings form (who does not work in
// Cowork) stays on the screen on purpose: it is a manager's decision.

export function registerUsageTools(server: McpServer): void {
  server.registerTool(
    "get_claude_usage",
    {
      title: "Get the team's Claude usage",
      description: [
        "How close each Ankora employee is to Claude's limits, and where the allowance goes, in the last 7 or 30 days, as on the screen /app/claude-usage. Super admins only.",
        "Per person: the five-hour window and the weekly limit with their pace, limit hits, requests and how heavy the work was, the cache, models, connector calls and prompts copied from Ankora. Per Ankora tool: calls, answer sizes, refusals, truncation, images and repeat reads. Also signs of waste and the heaviest single requests.",
        "Use it to say who is close to getting stuck and what to shrink. It holds no prompt or answer text, only sizes and counts.",
        FIELD_NOTES_SENTENCE,
      ].join(" "),
      inputSchema: z.object({
        days: z.union([z.literal(7), z.literal(30)]).optional().describe("7 (default) or 30."),
      }),
      annotations: TOOL_ANNOTATIONS.get_claude_usage,
    },
    async (args: { days?: 7 | 30 }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const report = await getClaudeUsageReport(actor, { days: args.days ?? 7 });
        return toolJson(
          withFieldNotes(
            {
              url: `${appBaseUrl()}/app/claude-usage?days=${report.period.days}`,
              units: "costUsd is API list price (Cowork's estimate), not money spent. Sizes in bytes. Times in UTC.",
              ...report,
            },
            CLAUDE_USAGE_NOTES
          )
        );
      } catch (err) {
        console.error("[mcp] get_claude_usage failed", err);
        return toolFailure(err);
      }
    }
  );
}
