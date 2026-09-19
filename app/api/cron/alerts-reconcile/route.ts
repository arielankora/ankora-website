import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { reconcileAllClientAlerts, retryFailedEmailDeliveries } from "@/lib/app-domain/alerts";
import { notifyLongRunningTimers } from "@/lib/app-domain/notifications";
import { reconcileImportantDates } from "@/lib/app-domain/important-dates-job";

// Spec 9.2's "scheduled reconciliation" + retry-with-backoff ideal,
// approximated here as a single once-daily Vercel Cron job (see ADR 11.3 -
// no job queue or sub-daily scheduler exists in this stack, so daily is
// the coarsest-but-honest interpretation). Protected the same way Vercel
// recommends for Cron routes: the platform sends `Authorization: Bearer
// ${CRON_SECRET}` on every cron-triggered request, and this route rejects
// anything else so the endpoint can't be triggered by an outside caller
// who doesn't know the secret.
export async function GET(request: Request) {
  // Security review: constant-time comparison, shared with the other
  // cron route - see lib/cron-auth.ts for the CWE-208 reasoning.
  const authorized = authorizeCronRequest(request);
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }

  try {
    // Phase 9 gap-fix (docs/adr/0001 section 17.2): long-timer
    // notifications reuse this same daily cron rather than a new job -
    // see lib/app-domain/notifications.ts's own comment for why.
    const [reconciled, retried, longTimers, importantDates] = await Promise.all([
      reconcileAllClientAlerts(),
      retryFailedEmailDeliveries(),
      notifyLongRunningTimers(),
      // Phase 10 (Important Dates): reuses this same daily cron rather
      // than a new job - see lib/app-domain/important-dates-job.ts's own
      // header comment for why (same ADR 11.3 "no sub-daily scheduler"
      // reasoning as reconcileAllClientAlerts/notifyLongRunningTimers
      // above).
      reconcileImportantDates(),
    ]);

    return NextResponse.json({
      ok: true,
      reconciled,
      retried,
      longTimersNotified: longTimers.notified,
      importantDates,
    });
  } catch (err) {
    console.error("alerts-reconcile cron failed:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
