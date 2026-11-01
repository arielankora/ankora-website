import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { reconcileRecordings, sweepCallRetention, transcribePending } from "@/lib/comms/call-store";
import { backfillChannel, sweepWhatsappRetention } from "@/lib/comms/whatsapp-store";
import { prisma } from "@/lib/prisma";

// Nightly (communications storage, 1.11.2026): store the call recordings
// the webhook missed, load the WhatsApp history of stored numbers, transcribe
// what is waiting, and apply the retention the spec sets. The first run also walks back through the
// mailbox's history; what does not fit in one run continues the next night.
// Same CRON_SECRET protection as the other cron routes.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authorized = authorizeCronRequest(request);
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }
  try {
    const reconcile = await reconcileRecordings({ budgetMs: 90_000 });
    // Stage 3: the WhatsApp history of each stored number, a little each
    // night until every chat has been read once.
    const whatsapp = [];
    for (const channel of await prisma.commsChannel.findMany({ where: { storeEnabled: true } })) {
      whatsapp.push(await backfillChannel(channel, { budgetMs: 60_000 }));
    }
    const transcribe = await transcribePending({ budgetMs: 110_000 });
    const retention = { calls: await sweepCallRetention(), whatsapp: await sweepWhatsappRetention() };
    return NextResponse.json({ ok: true, reconcile, whatsapp, transcribe, retention });
  } catch (err) {
    console.error("comms-recordings cron failed:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
