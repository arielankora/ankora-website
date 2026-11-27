import { sweepMailWaits } from "@/lib/mail-scan/waits";
import { runCron } from "@/lib/cron-run";

// Stage 2 of "התיבות שלי" (27.11.2026): reminders for tasks that wait for an
// email reply and got none, and emails kept 14 days that nobody followed.
// The webhook runs the same sweep during the day (at most every ten
// minutes); this is the morning run that does not depend on mail arriving.
// Same CRON_SECRET protection as the other cron routes.
export async function GET(request: Request) {
  return runCron("mail-waits", request, async (step) => ({ ...(await step("sweep", () => sweepMailWaits())) }));
}
