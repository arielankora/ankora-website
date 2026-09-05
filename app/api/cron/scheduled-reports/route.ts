import { NextResponse } from "next/server";
import { reconcileScheduledReports } from "@/lib/app-domain/report-schedules";

// Spec 15's weekly/monthly scheduled email reports, checked hourly (finer
// grained than Phase 4's once-daily alerts-reconcile cron, since a
// schedule's configured `hour` needs to be matched within the same hour
// it falls in - see lib/app-domain/report-schedules.ts's isScheduleDue).
// Same CRON_SECRET bearer-token protection as
// app/api/cron/alerts-reconcile/route.ts.
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
    const result = await reconcileScheduledReports();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("scheduled-reports cron failed:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
