import { NextResponse } from "next/server";
import { reconcileAllClientAlerts, retryFailedEmailDeliveries } from "@/lib/app-domain/alerts";

// Spec 9.2's "scheduled reconciliation" + retry-with-backoff ideal,
// approximated here as a single once-daily Vercel Cron job (see ADR 11.3 -
// no job queue or sub-daily scheduler exists in this stack, so daily is
// the coarsest-but-honest interpretation). Protected the same way Vercel
// recommends for Cron routes: the platform sends `Authorization: Bearer
// ${CRON_SECRET}` on every cron-triggered request, and this route rejects
// anything else so the endpoint can't be triggered by an outside caller
// who doesn't know the secret.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [reconciled, retried] = await Promise.all([
      reconcileAllClientAlerts(),
      retryFailedEmailDeliveries(),
    ]);

    return NextResponse.json({ ok: true, reconciled, retried });
  } catch (err) {
    console.error("alerts-reconcile cron failed:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
