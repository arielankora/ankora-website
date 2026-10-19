/// What the shell shows about the person's running timers: the oldest
/// one's start, and how many more are running beside it. Null when none.
export type ActiveTimerSummary = { startAt: string; extraCount: number } | null;

/// Same rule the layout has used since parallel timers (5.10.2026): one
/// pill, for the oldest, with "+N" for the rest.
export function summariseActiveTimers(rows: { startAt: Date | string }[]): ActiveTimerSummary {
  if (rows.length === 0) return null;
  const starts = rows.map((r) => (typeof r.startAt === "string" ? r.startAt : r.startAt.toISOString()));
  const oldest = starts.reduce((a, b) => (new Date(a).getTime() <= new Date(b).getTime() ? a : b));
  return { startAt: oldest, extraCount: rows.length - 1 };
}

/// Two summaries describe the same state. Compared by instant, not by
/// string, so "...Z" and "+00:00" spellings of one moment agree.
export function sameSummary(a: ActiveTimerSummary, b: ActiveTimerSummary): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a.startAt).getTime() === new Date(b.startAt).getTime() && a.extraCount === b.extraCount;
}
