import "server-only";
import { UnipileError } from "@/lib/whatsapp-poc/unipile";
import { alertAdmins } from "./admin-alert";
import { alertChannelDisconnected } from "./disconnect-alert";

export const CHANNEL_BACKFILL_FAILED_NOTIFICATION_TYPE = "channel_backfill_failed";

/// The nightly WhatsApp step, one number at a time. Until 24.11.2026 one
/// number that failed (Anna's WhatsApp, disconnected in Unipile) threw out
/// of the loop and stopped the whole run: the numbers after it, the
/// transcripts, the Drive copies and the retention sweep, every night, with
/// only a line in the log. Now a failing number is skipped, the rest go on,
/// and the admins are told which number failed and why.
export async function runPerChannel<C extends { id: string }, R>(
  channels: readonly C[],
  run: (channel: C) => Promise<R>,
  onFailure: (channel: C, err: unknown) => Promise<void>,
): Promise<Array<({ channelId: string; failed: false } & R) | { channelId: string; failed: true }>> {
  const out: Array<({ channelId: string; failed: false } & R) | { channelId: string; failed: true }> = [];
  for (const channel of channels) {
    try {
      out.push({ channelId: channel.id, failed: false, ...(await run(channel)) });
    } catch (err) {
      console.error("comms-recordings: WhatsApp backfill failed for a channel", { channelId: channel.id }, err);
      out.push({ channelId: channel.id, failed: true });
      try {
        await onFailure(channel, err);
      } catch (alertErr) {
        // The alert itself failing must not stop the run either; the log keeps both.
        console.error("comms-recordings: could not send the channel failure alert", { channelId: channel.id }, alertErr);
      }
    }
  }
  return out;
}

/// The alert for one number whose nightly step failed. A 401 is a number
/// Unipile disconnected, so its owner is told too, in case Unipile's
/// disconnect event was missed (lib/comms/disconnect-alert.ts).
export async function alertChannelFailure(
  channel: { id: string; accountId: string; owner: { name: string | null } },
  err: unknown,
): Promise<void> {
  const error = err instanceof Error ? err.message : String(err);
  if (err instanceof UnipileError && err.status === 401) await alertChannelDisconnected(channel.accountId);
  await alertAdmins({
    type: CHANNEL_BACKFILL_FAILED_NOTIFICATION_TYPE,
    subjectId: channel.id,
    entityType: "CommsChannel",
    render: (t) => ({
      title: t("channelBackfillFailed.title", { owner: channel.owner.name ?? "" }),
      body: t("channelBackfillFailed.body", { owner: channel.owner.name ?? "", error }),
    }),
  });
}
