import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { sweepMailWaits } from "@/lib/mail-scan/waits";

// Stage 2 of "התיבות שלי" (27.11.2026): reminders for tasks that wait for an
// email reply and got none, and emails kept 14 days that nobody followed.
// The webhook runs the same sweep during the day (at most every ten
// minutes); this is the morning run that does not depend on mail arriving.
// Same CRON_SECRET protection as the other cron routes.
export async function GET(request: Request) {
  const authorized = authorizeCronRequest(request);
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }
  try {
    const result = await sweepMailWaits();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("mail-waits cron failed:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
