// The nightly communications run has COMMS_CRON_MAX_DURATION_S on Vercel (maxDuration; 300 until 27.11.2026).
// Its steps each had a fixed budget (90 + 60 per WhatsApp number + 90 + 30
// seconds), which fit one number but not three: the first night, with one
// number, already took 262 seconds. Now the steps share one deadline, and
// the WhatsApp history step splits its time between the stored numbers.
//
// A step checks its budget between items, so one item can run past it (a
// transcription takes up to a minute). The deadline leaves room for that
// and for the retention sweeps that run last.
//
// 27.11.2026: 300 seconds was Vercel's default, and the Hobby ceiling; the
// team is on Pro since 15.10.2026, where a function may run 800 seconds
// (vercel.com/docs/functions/limitations). Two nights ran past the old
// 200-second deadline (226 and 208 seconds) and the steps after it got no
// time at all: the Drive copies, and on 27.11 the transcription too. A long
// recording is now split and transcribed part by part (about three minutes
// for 35 minutes of audio), so the run has room for that, and the deadline
// leaves 200 seconds under Vercel's ceiling for one item that runs over.

/// The route's maxDuration (app/api/cron/comms-recordings/route.ts). Next
/// reads that one as a literal, so a unit test checks the two agree.
export const COMMS_CRON_MAX_DURATION_S = 800;

export const COMMS_CRON_DEADLINE_MS = 600_000;

/// In the order the run takes them (27.11.2026): what was already stored
/// is transcribed and copied first, and the WhatsApp history, which goes on
/// from where it stopped every night, gets what is left.
export const COMMS_CRON_STEPS = {
  reconcile: 60_000,
  transcribe: 300_000,
  driveCopies: 90_000,
  whatsapp: 120_000,
} as const;

/// A step's budget: its own share, cut to what is left before the deadline.
export function stepBudget(share: number, startedAt: number, now: number, deadlineMs = COMMS_CRON_DEADLINE_MS): number {
  return Math.max(0, Math.min(share, startedAt + deadlineMs - now));
}

/// The WhatsApp step's share for the next stored number (27.11.2026).
///
/// Until then each number got a fixed fifth of 120 seconds: 24 seconds,
/// one or two chats a night, while the numbers whose history was already
/// loaded used none of theirs, and the run ended 120 seconds before its
/// deadline. Hadas had 15 chats loaded after three nights. Now the step has
/// what is left before the deadline (at least COMMS_CRON_STEPS.whatsapp,
/// since the steps before it fit inside it), and each number takes an even
/// part of what is still left, so what one number does not use goes to the
/// numbers after it.
export function nextChannelShare(channelsLeft: number, startedAt: number, now: number, deadlineMs = COMMS_CRON_DEADLINE_MS): number {
  if (channelsLeft <= 0) return 0;
  return Math.floor(stepBudget(deadlineMs, startedAt, now, deadlineMs) / channelsLeft);
}
