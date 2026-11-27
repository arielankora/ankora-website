import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson } from "@/lib/mcp/errors";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { appBaseUrl } from "@/lib/email-templates";
import { annotateSystemIssue, cronHealth, issuesForAi, listSystemIssues } from "@/lib/app-domain/system-issues";

// System issues (27.11.2026, silent failures plan, stage 1b): the failures
// the system recorded and the nightly runs, as on /app/system-issues, for
// the nightly analysis and for an admin who asks Claude what is broken.
// Admins only; anyone else gets the domain's refusal in its own words.
//
// Closing an issue stays on the screen on purpose: it says "this is
// handled", and that is a person's call. Claude leaves a note and the link
// of a pull request that fixes it (annotate_system_issue).

export function registerSystemIssueTools(server: McpServer): void {
  server.registerTool(
    "list_system_issues",
    {
      title: "List Ankora's system issues",
      description: [
        "The failures Ankora recorded (an email that did not go out, a nightly step that failed, a connector tool that failed, a server error) and the latest run of each nightly job, as on the screen /app/system-issues. Admins only.",
        "Each issue is one row per failure, counted when it happens again, with its first and last time, its error, and any note or pull request link left on it.",
        "Pass sinceHours to read only issues seen lately (24 for the last day). Use it to say what is broken now and what keeps coming back.",
      ].join(" "),
      inputSchema: z.object({
        status: z.enum(["OPEN", "RESOLVED", "ALL"]).optional().describe("OPEN (default), RESOLVED (closed in the last 14 days) or ALL."),
        sinceHours: z.number().int().min(1).max(720).optional().describe("Only issues seen in this many hours."),
        area: z.string().max(40).optional().describe("Only one area: email, cron, mcp, server, after-response, comms."),
      }),
      annotations: TOOL_ANNOTATIONS.list_system_issues,
    },
    async (args: { status?: "OPEN" | "RESOLVED" | "ALL"; sinceHours?: number; area?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const { open, resolved } = await listSystemIssues(actor, { status: args.status ?? "OPEN", sinceHours: args.sinceHours, area: args.area });
        const jobs = await cronHealth(actor);
        return toolJson({
          url: `${appBaseUrl()}/app/system-issues`,
          units: "Times in UTC. severity CRITICAL emails the admins (at most once in 20 hours); WARNING does not.",
          open: issuesForAi(open),
          resolved: issuesForAi(resolved),
          nightlyJobs: jobs,
        });
      } catch (err) {
        console.error("[mcp] list_system_issues failed", err);
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "annotate_system_issue",
    {
      title: "Leave a note or a pull request link on a system issue",
      description: [
        "Saves a note and/or the link of a pull request that fixes a system issue, so the screen and the next analysis see it is being handled. Admins only. It does not close the issue: a person closes it on /app/system-issues.",
        "Take issueId from list_system_issues. The link must be a pull request in Ankora's GitHub repositories.",
      ].join(" "),
      inputSchema: z.object({
        issueId: z.string().min(1).max(40),
        note: z.string().max(1000).optional().describe("What was found or done, in Hebrew."),
        prUrl: z.string().max(200).optional().describe("https://github.com/arielankora/<repo>/pull/<number>"),
      }),
      annotations: TOOL_ANNOTATIONS.annotate_system_issue,
    },
    async (args: { issueId: string; note?: string; prUrl?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const [issue] = issuesForAi([await annotateSystemIssue(actor, args.issueId, { note: args.note, prUrl: args.prUrl })]);
        return toolJson({ saved: true, url: `${appBaseUrl()}/app/system-issues`, issue });
      } catch (err) {
        console.error("[mcp] annotate_system_issue failed", err);
        return toolFailure(err);
      }
    },
  );
}
