import { pruneClaudeUsage } from "@/lib/claude-usage/record";
import { runCron } from "@/lib/cron-run";

// Claude usage measurement (17.11.2026): deletes tool-call and prompt-copy
// measurements older than CLAUDE_USAGE_RETENTION_DAYS, and Cowork events
// older than COWORK_EVENTS_RETENTION_DAYS. Its own cron so it
// can be run by hand without running anything else. Same CRON_SECRET
// protection as the other cron routes.
export async function GET(request: Request) {
  return runCron("claude-usage-retention", request, async (step) => ({ ...(await step("prune", () => pruneClaudeUsage())) }));
}
