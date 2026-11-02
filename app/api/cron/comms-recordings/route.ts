import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { reconcileRecordings, sweepCallRetention, transcribePending } from "@/lib/comms/call-store";
import { backfillChannel, sweepWhatsappRetention } from "@/lib/comms/whatsapp-store";
import { completeDriveCopies, repairCallLines, sweepEndedEngagements } from "@/lib/comms/maintenance";
import { COMMS_CRON_STEPS, perChannelShare, stepBudget } from "@/lib/comms/cron-budget";
import { prisma } from "@/lib/prisma";

// Nightly (communications storage, 1.11.2026): store the call recordings
// the webhook missed, load the WhatsApp history of stored numbers, transcribe
// what is waiting, and apply the retention the spec sets. The first run also walks back through the
// mailbox's history; what does not fit in one run continues the next night.
// Same CRON_SECRET protection as the other cron routes.
//
// 2.11.2026: the steps share one deadline (lib/comms/cron-budget.ts), and
// the run writes a one-line summary to the log (counts and seconds per
// step, no names or numbers), so the morning check can read what it did.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authorized = authorizeCronRequest(request);
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }
  const startedAt = Date.now();
  const seconds: Record<string, number> = {};
  async function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      return await run();
    } finally {
      seconds[name] = Math.round((Date.now() - t) / 100) / 10;
    }
  }
  const budget = (share: number) => stepBudget(share, startedAt, Date.now());

  try {
    const reconcile = await timed("reconcile", () => reconcileRecordings({ budgetMs: budget(COMMS_CRON_STEPS.reconcile) }));
    const lines = await timed("lines", () => repairCallLines());
    // Stage 3: the WhatsApp history of each stored number, a little each
    // night until every chat has been read once.
    const channels = await prisma.commsChannel.findMany({ where: { storeEnabled: true } });
    const share = perChannelShare(channels.length);
    const whatsapp = await timed("whatsapp", async () => {
      const out = [];
      for (const channel of channels) out.push(await backfillChannel(channel, { budgetMs: budget(share) }));
      return out;
    });
    const transcribe = await timed("transcribe", () => transcribePending({ budgetMs: budget(COMMS_CRON_STEPS.transcribe) }));
    const driveCopies = await timed("driveCopies", () => completeDriveCopies({ budgetMs: budget(COMMS_CRON_STEPS.driveCopies) }));
    const retention = await timed("retention", async () => ({
      calls: await sweepCallRetention(),
      whatsapp: await sweepWhatsappRetention(),
      endedEngagements: await sweepEndedEngagements(),
    }));
    const summary = { ok: true, reconcile, lines, whatsapp, transcribe, driveCopies, retention, seconds, totalSeconds: Math.round((Date.now() - startedAt) / 1000) };
    console.log(`comms-recordings summary ${JSON.stringify(summary)}`);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("comms-recordings cron failed:", err, { seconds });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
