import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { reconcileRecordings, sweepCallRetention, transcribePending } from "@/lib/comms/call-store";

// Nightly (communications storage, stage 2, 1.11.2026): store the call
// recordings the webhook missed, transcribe what is waiting, and apply the
// retention the spec sets. The first run also walks back through the
// mailbox's history; what does not fit in one run continues the next night.
// Same CRON_SECRET protection as the other cron routes.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authorized = authorizeCronRequest(request);
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }
  try {
    const reconcile = await reconcileRecordings({ budgetMs: 120_000 });
    const transcribe = await transcribePending({ budgetMs: 140_000 });
    const retention = await sweepCallRetention();
    return NextResponse.json({ ok: true, reconcile, transcribe, retention });
  } catch (err) {
    console.error("comms-recordings cron failed:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
