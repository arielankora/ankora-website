// Claude usage measurement, stage 3 (17.11.2026): the arithmetic behind
// the "שימוש בקלוד" screen and the get_claude_usage tool. Pure, so every
// rule here is tested without a database.
//
// The goal the numbers serve (Ariel, 17.11.2026): nobody stuck in the
// five-hour window, nobody moved to a dearer seat, and no Ankora tool or
// prompt sending Claude more than the work needs. Money barely moves on a
// Team plan, so cost here is Cowork's estimate, used as a measure of how
// heavy the work was.

export type ToolCallIn = {
  userId: string | null;
  tool: string;
  ok: boolean;
  resultBytes: number;
  resultChars: number;
  imageCount: number;
  truncated: boolean;
  argsHash: string;
  createdAt: Date;
};

export type CoworkEventIn = {
  eventName: string;
  userId: string | null;
  occurredAt: Date;
  promptId: string | null;
  model: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  statusCode: string | null;
  errorText: string | null;
  toolName: string | null;
  toolResultBytes: number | null;
  mcpTool: string | null;
};

const MINUTE = 60_000;

/// Claude's usage window: five hours from the first message after the
/// previous window ended.
export const WINDOW_MS = 5 * 60 * MINUTE;

/// A repeat of the same read, by the same person, within this long, is
/// almost always one conversation reading something it already had.
export const DUPLICATE_WITHIN_MS = 30 * MINUTE;

/// get_client_brief, then get_client_file for the same person within this
/// long: the brief did not answer and Claude went for the whole file.
export const ESCALATION_WITHIN_MS = 15 * MINUTE;

/// A Cowork tool result and an Ankora call are the same call when they are
/// this close in time and their sizes agree within SIZE_TOLERANCE.
export const CORRELATE_WITHIN_MS = 2 * MINUTE;
const SIZE_TOLERANCE = 0.05;
const SIZE_SLACK_BYTES = 64;

/// Was this API error the person's limit? Anthropic answers a usage limit
/// with HTTP 429 and an error that names the limit. Checked on the first
/// real data, and widened here if Cowork words it differently.
export function isLimitHit(e: Pick<CoworkEventIn, "eventName" | "statusCode" | "errorText">): boolean {
  if (e.eventName !== "api_error") return false;
  if (e.statusCode === "429") return true;
  return /rate[ _-]?limit|usage[ _-]?limit|limit (reached|exceeded)/i.test(e.errorText ?? "");
}

export const tokensOf = (e: CoworkEventIn): number =>
  (e.inputTokens ?? 0) + (e.outputTokens ?? 0) + (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0);

export type UsageWindow = { start: Date; costUsd: number; tokens: number; requests: number; limitHits: number };

/// One person's events cut into five-hour windows. Only API requests and
/// limit hits count; a window starts at the first of them after the last
/// window ended.
export function fiveHourWindows(events: CoworkEventIn[]): UsageWindow[] {
  const relevant = events
    .filter((e) => e.eventName === "api_request" || isLimitHit(e))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const windows: UsageWindow[] = [];
  let current: UsageWindow | null = null;
  for (const e of relevant) {
    if (!current || e.occurredAt.getTime() >= current.start.getTime() + WINDOW_MS) {
      current = { start: e.occurredAt, costUsd: 0, tokens: 0, requests: 0, limitHits: 0 };
      windows.push(current);
    }
    if (e.eventName === "api_request") {
      current.costUsd += e.costUsd ?? 0;
      current.tokens += tokensOf(e);
      current.requests += 1;
    } else {
      current.limitHits += 1;
    }
  }
  return windows;
}

export function heaviestWindow(windows: UsageWindow[]): UsageWindow | null {
  return windows.reduce<UsageWindow | null>((best, w) => (!best || w.costUsd > best.costUsd ? w : best), null);
}

/// Calls that repeat an earlier read by the same person, same tool and
/// same arguments, within DUPLICATE_WITHIN_MS of it. Writes are left out:
/// a write made twice is a different problem, and a deliberate one is
/// possible. Returns how many repeats each tool had.
export function duplicateReads(calls: ToolCallIn[], readOnly: (tool: string) => boolean): Map<string, number> {
  const lastSeen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const c of [...calls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!c.userId || !c.ok || !readOnly(c.tool)) continue;
    const key = `${c.userId}\u0000${c.tool}\u0000${c.argsHash}`;
    const t = c.createdAt.getTime();
    const prev = lastSeen.get(key);
    if (prev !== undefined && t - prev <= DUPLICATE_WITHIN_MS) out.set(c.tool, (out.get(c.tool) ?? 0) + 1);
    lastSeen.set(key, t);
  }
  return out;
}

/// How often the short brief of a client was followed by the whole file.
export function briefThenFile(calls: ToolCallIn[]): number {
  const lastBrief = new Map<string, number>();
  let count = 0;
  for (const c of [...calls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!c.userId || !c.ok) continue;
    const t = c.createdAt.getTime();
    if (c.tool === "get_client_brief") lastBrief.set(c.userId, t);
    else if (c.tool === "get_client_file") {
      const b = lastBrief.get(c.userId);
      if (b !== undefined && t - b <= ESCALATION_WITHIN_MS) {
        count += 1;
        lastBrief.delete(c.userId);
      }
    }
  }
  return count;
}

/// Which Ankora tool a Cowork tool result was. Cowork names an MCP tool
/// only when a device is set to send tool details, so without that the
/// name comes from our own log: the same person, close in time, the same
/// size. Returns null when nothing matches well enough.
export function ankoraToolFor(event: CoworkEventIn, userCalls: ToolCallIn[]): string | null {
  if (event.mcpTool) return event.mcpTool;
  if (event.eventName !== "tool_result" || event.toolName !== "mcp_tool" || event.toolResultBytes === null) return null;
  const t = event.occurredAt.getTime();
  const size = event.toolResultBytes;
  let best: { tool: string; gap: number } | null = null;
  for (const c of userCalls) {
    const gap = Math.abs(c.createdAt.getTime() - t);
    if (gap > CORRELATE_WITHIN_MS) continue;
    const slack = Math.max(SIZE_SLACK_BYTES, size * SIZE_TOLERANCE);
    if (Math.abs(c.resultBytes - size) > slack) continue;
    if (!best || gap < best.gap) best = { tool: c.tool, gap };
  }
  return best?.tool ?? null;
}

export type SeatStatus = "ok" | "near" | "over";

/// Days of measurement before a pace is worth stating. With less, a
/// morning's work stretched over a month says nothing (17.11.2026: on the
/// first day, half an hour of use projected a month at 9% of the seat).
export const MIN_DAYS_FOR_PACE = 3;

/// Where a person stands against their seat this month, by Cowork's
/// estimate. "over": the month so far is past the threshold. "near": the
/// pace since measurement began would pass it by the end of the month.
///
/// The pace counts only the days that were measured: a month whose first
/// half had no telemetry is not averaged over days nobody counted.
export function seatStatus(input: {
  monthCostUsd: number;
  seatUsd: number;
  multiplier: number;
  /// Days measured this month so far (since the month began, or since
  /// telemetry started if that was later).
  measuredDays: number;
  /// Days left until the month ends.
  daysLeft: number;
}): { status: SeatStatus; thresholdUsd: number; projectedUsd: number | null } {
  const thresholdUsd = round2(input.seatUsd * input.multiplier);
  const projectedUsd =
    input.measuredDays >= MIN_DAYS_FOR_PACE
      ? round2(input.monthCostUsd + (input.monthCostUsd / input.measuredDays) * Math.max(0, input.daysLeft))
      : null;
  const status: SeatStatus =
    input.monthCostUsd > thresholdUsd ? "over" : projectedUsd !== null && projectedUsd > thresholdUsd ? "near" : "ok";
  return { status, thresholdUsd, projectedUsd };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
