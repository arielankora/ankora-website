import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { pruneClaudeUsage } from "@/lib/claude-usage/record";

// Claude usage measurement (17.11.2026): deletes tool-call and prompt-copy
// measurements older than CLAUDE_USAGE_RETENTION_DAYS, and Cowork events
// older than COWORK_EVENTS_RETENTION_DAYS. Its own cron so it
// can be run by hand without running anything else. Same CRON_SECRET
// protection as the other cron routes.
export async function GET(request: Request) {
  const authorized = authorizeCronRequest(request);
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }
  try {
    const result = await pruneClaudeUsage();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("claude-usage-retention cron failed:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
