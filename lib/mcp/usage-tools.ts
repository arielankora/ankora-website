import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson } from "@/lib/mcp/errors";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { appBaseUrl } from "@/lib/email-templates";
import { getClaudeUsageReport } from "@/lib/app-domain/claude-usage";

// Claude usage measurement, stage 3 (17.11.2026): get_claude_usage. The
// same report as the "שימוש בקלוד" screen, for the weekly usage report and
// for a manager who asks Claude where the allowance goes. SUPER_ADMIN only;
// anyone else gets the domain's refusal in its own words.
//
// Nothing here is a client's data: names of staff, sizes, counts and
// Cowork's cost estimates. The settings form stays on the screen on
// purpose: seats and the threshold are a manager's decision, not Claude's.

export function registerUsageTools(server: McpServer): void {
  server.registerTool(
    "get_claude_usage",
    {
      title: "Get the team's Claude usage",
      description: [
        "How much of Claude's allowance each Ankora employee used in the last 7 or 30 days, as on the screen /app/claude-usage. Super admins only.",
        "Per person: Cowork requests, Cowork's estimated cost (an estimate of how heavy the work was, not a bill: the Team plan charges per seat), tokens by kind, the share read from the cache, models, limit hits (errors where the five-hour window ran out), the heaviest five-hour window, connector calls and bytes, prompts copied from Ankora, and this month against their threshold (seat price times the multiplier) with the pace to month end.",
        "fiveHour, and fiveHour on each person: the five-hour window, where people actually get stuck. Who is stuck now and when their window resets, who is over 70% of the current window, limit hits in the past week and the hours they cluster in (Israel time), and each person's past week window by window with the peak share. Shares come from the browser extension; without it only Cowork's limit errors show, and the share is null.",
        "Per Ankora tool: calls, size of the answers (average, largest, total), refusals, truncated answers, images and repeat reads. Also the prompts Ankora builds, signs of waste (a client brief followed by the whole file, repeat reads, truncation), and the heaviest single requests with the Ankora tools they ran.",
        "Use it to say where the allowance goes and what to shrink. It holds no prompt or answer text, only sizes and counts.",
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
        return toolJson({
          url: `${appBaseUrl()}/app/claude-usage?days=${report.period.days}`,
          units: "Money in USD (Cowork's estimate). Sizes in bytes. Times in UTC.",
          ...report,
        });
      } catch (err) {
        console.error("[mcp] get_claude_usage failed", err);
        return toolFailure(err);
      }
    }
  );
}
