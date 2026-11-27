import { reconcileAllClientAlerts, retryFailedEmailDeliveries } from "@/lib/app-domain/alerts";
import { notifyLongRunningTimers } from "@/lib/app-domain/notifications";
import { reconcileImportantDates } from "@/lib/app-domain/important-dates-job";
import { purgeExpiredWebsiteLeads } from "@/lib/website-leads";
import { sendDailyTaskDigest } from "@/lib/app-domain/task-digest";
import { notifyClientFileAttention } from "@/lib/app-domain/client-file-attention";
import { sendWeeklyBrainMetrics } from "@/lib/app-domain/brain-metrics";
import { openOverdueVendorRuns } from "@/lib/app-domain/vendor-detections";
import { runCron } from "@/lib/cron-run";

// Spec 9.2's "scheduled reconciliation" + retry-with-backoff ideal,
// approximated here as a single once-daily Vercel Cron job (see ADR 11.3 -
// no job queue or sub-daily scheduler exists in this stack, so daily is
// the coarsest-but-honest interpretation). Protected the same way Vercel
// recommends for Cron routes: the platform sends `Authorization: Bearer
// ${CRON_SECRET}` on every cron-triggered request, and this route rejects
// anything else so the endpoint can't be triggered by an outside caller
// who doesn't know the secret.
export async function GET(request: Request) {
  // Each its own step (27.11.2026): one that throws is a system issue and
  // the others' results still come back. Before, any of the first six
  // throwing turned the whole run into one "Unexpected error" in the log.
  return runCron("alerts-reconcile", request, async (step) => {
    const [reconciled, retried, longTimers, importantDates, digest, leadRetention, clientFiles, brainMetrics, vendorRuns] = await Promise.all([
      step("clientAlerts", () => reconcileAllClientAlerts()),
      step("emailRetries", () => retryFailedEmailDeliveries()),
      step("longTimers", () => notifyLongRunningTimers()),
      step("importantDates", () => reconcileImportantDates()),
      step("taskDigest", () => sendDailyTaskDigest()),
      step("leadRetention", () => purgeExpiredWebsiteLeads()),
      step("clientFiles", () => notifyClientFileAttention()),
      step("brainMetrics", () => sendWeeklyBrainMetrics()),
      step("vendorRuns", () => openOverdueVendorRuns()),
    ]);
    return { reconciled, retried, longTimers, importantDates, digest, leadRetention, clientFiles, brainMetrics, vendorRuns };
  });
}
