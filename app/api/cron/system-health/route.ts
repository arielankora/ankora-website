import { runCron } from "@/lib/cron-run";
import { runHealthChecks } from "@/lib/system-health";
import { sendSystemDigest } from "@/lib/system-digest";

// Every morning (27.11.2026, silent failures plan, stages 2 and 3): the
// checks of what should have happened (lib/system-health.ts), then the
// morning report on system issues to the admins (lib/system-digest.ts),
// which reads what the checks just found. Before the alerts cron, so the
// report is in the inbox before the day starts. Same CRON_SECRET
// protection as the other cron routes, through runCron.
export async function GET(request: Request) {
  return runCron("system-health", request, async (step) => {
    const checks = await step("checks", async () => {
      const r = await runHealthChecks();
      // Counts only in the answer: the titles name people and clients.
      return { checked: r.checked, failed: r.failed };
    });
    const digest = await step("digest", () => sendSystemDigest());
    return { checks, digest };
  });
}
