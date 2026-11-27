import { runCron, type CronStep } from "@/lib/cron-run";
import { reconcileRecordings, sweepCallRetention, transcribePending } from "@/lib/comms/call-store";
import { backfillChannel, sweepWhatsappRetention } from "@/lib/comms/whatsapp-store";
import { completeDriveCopies, repairCallLines, sweepEndedEngagements } from "@/lib/comms/maintenance";
import { retryDriveFileDeletions } from "@/lib/comms/drive-deletions";
import { COMMS_CRON_STEPS, nextChannelShare, stepBudget } from "@/lib/comms/cron-budget";
import { alertChannelFailure, runPerChannel } from "@/lib/comms/cron-channels";
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
//
// 27.11.2026: 800 seconds (Vercel Pro's ceiling), and the stored audio is
// transcribed and copied before the WhatsApp history is loaded, so a heavy
// history no longer leaves them no time (lib/comms/cron-budget.ts). A
// literal, as Next reads it; tests/unit/comms-cron-budget.test.ts checks it
// matches COMMS_CRON_MAX_DURATION_S.
export const maxDuration = 800;

export async function GET(request: Request) {
  const startedAt = Date.now();
  const seconds: Record<string, number> = {};
  const budget = (share: number) => stepBudget(share, startedAt, Date.now());

  // 27.11.2026 (silent failures audit): every step is isolated. Before, a
  // mailbox that answered 401 in the first step stopped transcription,
  // Drive copies, the WhatsApp history and retention for the whole night,
  // with one line in the log. #619 had isolated only the WhatsApp step.
  return runCron("comms-recordings", request, async (rawStep) => {
    const step: CronStep = async (name, run) => {
      const t = Date.now();
      try {
        return await rawStep(name, run);
      } finally {
        seconds[name] = Math.round((Date.now() - t) / 100) / 10;
      }
    };
    const reconcile = await step("reconcile", () => reconcileRecordings({ budgetMs: budget(COMMS_CRON_STEPS.reconcile) }));
    const lines = await step("lines", () => repairCallLines());
    const transcribe = await step("transcribe", () => transcribePending({ budgetMs: budget(COMMS_CRON_STEPS.transcribe) }));
    const driveCopies = await step("driveCopies", () => completeDriveCopies({ budgetMs: budget(COMMS_CRON_STEPS.driveCopies) }));
    // Stage 3: the WhatsApp history of each stored number, a little each
    // night until every chat has been read once. Its voice messages are
    // transcribed the next night (the live ones by the webhook).
    // 24.11.2026: one number failing no longer stops the run; it is skipped
    // and the admins get an alert (lib/comms/cron-channels.ts).
    const whatsapp = await step("whatsapp", async () => {
      const channels = await prisma.commsChannel.findMany({ where: { storeEnabled: true }, include: { owner: { select: { name: true } } } });
      // 27.11.2026: the numbers whose history is still loading go first, and
      // each takes an even part of the time left (lib/comms/cron-budget.ts).
      channels.sort((a, b) => Number(Boolean(a.historyLoadedAt)) - Number(Boolean(b.historyLoadedAt)));
      let channelsLeft = channels.length;
      return runPerChannel(
        channels,
        (channel) => backfillChannel(channel, { budgetMs: nextChannelShare(channelsLeft--, startedAt, Date.now()) }),
        alertChannelFailure,
      );
    });
    const retention = {
      calls: await step("retentionCalls", () => sweepCallRetention()),
      whatsapp: await step("retentionWhatsapp", () => sweepWhatsappRetention()),
      endedEngagements: await step("retentionEndedEngagements", () => sweepEndedEngagements()),
      // Drive files a sweep or a block could not delete before (27.11.2026).
      driveDeletions: await step("driveDeletions", () => retryDriveFileDeletions()),
    };
    const summary = { reconcile, lines, whatsapp, transcribe, driveCopies, retention, seconds, totalSeconds: Math.round((Date.now() - startedAt) / 1000) };
    console.log(`comms-recordings summary ${JSON.stringify(summary)}`);
    return summary;
  });
}
