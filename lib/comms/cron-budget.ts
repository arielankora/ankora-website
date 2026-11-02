// The nightly communications run has 300 seconds on Vercel (maxDuration).
// Its steps each had a fixed budget (90 + 60 per WhatsApp number + 90 + 30
// seconds), which fit one number but not three: the first night, with one
// number, already took 262 seconds. Now the steps share one deadline, and
// the WhatsApp history step splits its time between the stored numbers.
//
// A step checks its budget between items, so one item can run past it (a
// transcription takes up to a minute). The deadline leaves room for that
// and for the retention sweeps that run last.

export const COMMS_CRON_DEADLINE_MS = 200_000;

export const COMMS_CRON_STEPS = {
  reconcile: 60_000,
  whatsapp: 50_000,
  transcribe: 60_000,
  driveCopies: 30_000,
} as const;

/// A step's budget: its own share, cut to what is left before the deadline.
export function stepBudget(share: number, startedAt: number, now: number, deadlineMs = COMMS_CRON_DEADLINE_MS): number {
  return Math.max(0, Math.min(share, startedAt + deadlineMs - now));
}

/// The WhatsApp step's share for each stored number.
export function perChannelShare(channels: number): number {
  return channels > 0 ? Math.floor(COMMS_CRON_STEPS.whatsapp / channels) : 0;
}
