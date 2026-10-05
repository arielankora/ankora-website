// Parallel timers (Ariel, 5.10.2026; spec claude/parallel-timers-spec-2026-10-05.md).
//
// A person may run up to MAX_PARALLEL_TIMERS timers at once, never two on
// the same client. The second one is a decision, not a detail: each
// client is billed the full time of its own timer, so the hour a person
// spends on hold for one client while working for another is counted
// twice. That is allowed, but only once the person has said yes to it.
//
// The rule lives here, pure, for the same reason time-entry-overlap.ts
// exists: the decision is unit-testable without a database, and every
// caller (timer screen, task screen, MCP, undo of a stop) asks the same
// function instead of re-deriving it.

export const MAX_PARALLEL_TIMERS = 2;

export type RunningTimerRef = { id: string; clientId: string };

export type TimerStartDecision =
  | { allowed: true; parallel: boolean }
  | { allowed: false; reason: "same_client" | "limit" | "needs_confirmation" };

/// Whether a timer for `clientId` may start next to the ones already running.
///
/// Order matters. A same-client collision is reported before the limit,
/// because "stop the other one" is not an answer to it: even with room
/// for another timer, this client already has one. The limit comes before
/// the confirmation, so nobody is asked to confirm something that is
/// refused anyway.
export function decideTimerStart(input: {
  running: RunningTimerRef[];
  clientId: string;
  confirmParallel: boolean;
}): TimerStartDecision {
  const { running, clientId, confirmParallel } = input;
  if (running.some((t) => t.clientId === clientId)) return { allowed: false, reason: "same_client" };
  if (running.length >= MAX_PARALLEL_TIMERS) return { allowed: false, reason: "limit" };
  if (running.length === 0) return { allowed: true, parallel: false };
  if (!confirmParallel) return { allowed: false, reason: "needs_confirmation" };
  return { allowed: true, parallel: true };
}

/// Whether a just-stopped timer may run again (the undo on "stopped").
///
/// No confirmation here. The person confirmed running in parallel when
/// they started the second timer, and an undo that asks a question back
/// is an undo nobody trusts. The two hard rules still hold.
export function decideTimerReopen(input: { running: RunningTimerRef[]; clientId: string }): TimerStartDecision {
  return decideTimerStart({ ...input, confirmParallel: true });
}

/// Total seconds and the part of them that ran in parallel, for a set of
/// closed entries. "Parallel" is the reported time beyond the wall-clock
/// time those entries actually cover: two entries 10:00-11:00 on two
/// clients are 7200 reported seconds over 3600 wall-clock seconds, so
/// 3600 of them ran in parallel.
export function parallelSeconds(entries: { startAt: Date | string; endAt: Date | string }[]): {
  reportedSeconds: number;
  wallClockSeconds: number;
  parallelSeconds: number;
} {
  const intervals = entries
    .map((e) => [new Date(e.startAt).getTime(), new Date(e.endAt).getTime()] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  let reported = 0;
  let wall = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const [s, e] of intervals) {
    reported += e - s;
    if (s > curEnd) {
      if (curEnd > curStart) wall += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart) wall += curEnd - curStart;

  const reportedSeconds = Math.round(reported / 1000);
  const wallClockSeconds = Math.round(wall / 1000);
  return { reportedSeconds, wallClockSeconds, parallelSeconds: Math.max(0, reportedSeconds - wallClockSeconds) };
}
