// Claude usage measurement, the managers' summary (17.11.2026, "אפשרות ג"):
// the top of the "שימוש בקלוד" screen. Ariel asked for something a manager
// can read in ten seconds, above the detailed tables: one verdict, six
// leading indicators against a target each, and at most three things to
// do this week. Pure, so every rule is tested without a database; the
// domain report (lib/app-domain/claude-usage.ts) feeds it and carries the
// result, so the screen and get_claude_usage say the same thing.
//
// Leading indicators are the ones that predict a person getting stuck in
// the five-hour window or needing a dearer seat, before either happens.
// The targets are a first guess, to be calibrated after two weeks of data
// (lib/claude-usage/summary.ts is the one place they live).

export type KpiState = "ok" | "watch" | "off" | "none";

export type KpiKey = "limitHits" | "closestToThreshold" | "cacheShare" | "duplicateRate" | "heavyModelShare" | "avgCallKb";

export type Kpi = {
  key: KpiKey;
  /// The figure, already rounded for display; null when there is no data.
  value: number | null;
  state: KpiState;
  /// Who, for the one indicator that is about a person.
  who?: string;
};

export type ActionKey = "shortenTool" | "checkTelemetry" | "lighterModel" | "repeatReads" | "limitHit" | "nearThreshold";
export type SummaryAction = { key: ActionKey; values: Record<string, string | number> };

export type Verdict = "ok" | "attention" | "partial";

export type ManagerSummary = {
  verdict: Verdict;
  kpis: Kpi[];
  actions: SummaryAction[];
};

/// Targets and the band where an indicator is worth watching before it is
/// off. Lower is better unless `higherIsBetter`.
export const KPI_TARGETS: Record<Exclude<KpiKey, "limitHits">, { target: number; watch: number; higherIsBetter?: boolean }> = {
  /// Percent of the monthly threshold used by the person closest to it.
  closestToThreshold: { target: 80, watch: 100 },
  /// Percent of input read from the cache. Low means conversations that
  /// start from nothing again and again.
  cacheShare: { target: 80, watch: 60, higherIsBetter: true },
  /// Percent of connector calls that repeat a read just made.
  duplicateRate: { target: 3, watch: 6 },
  /// Percent of Cowork requests on the heaviest model.
  heavyModelShare: { target: 50, watch: 75 },
  /// Average kilobytes one connector call sends back.
  avgCallKb: { target: 8, watch: 16 },
};

/// A tool whose answers are this share of everything the connector sent
/// is worth shortening first.
export const SHORTEN_TOOL_SHARE = 30;
/// ...and only when it sent this much in the period: on a quiet week every
/// tool is a large share of very little.
export const SHORTEN_TOOL_MIN_KB = 200;

function stateOf(key: Exclude<KpiKey, "limitHits">, value: number | null): KpiState {
  if (value === null) return "none";
  const { target, watch, higherIsBetter } = KPI_TARGETS[key];
  if (higherIsBetter) return value >= target ? "ok" : value >= watch ? "watch" : "off";
  return value <= target ? "ok" : value <= watch ? "watch" : "off";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/// The heaviest model is whichever name says "opus" today. A new heaviest
/// family is one word to add here.
export const isHeavyModel = (model: string) => /opus/i.test(model);

export type SummaryInput = {
  people: {
    name: string;
    cowork: { requests: number; inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; limitHits: number; models: { model: string; requests: number }[] };
    connector: { calls: number };
    month: { costUsd: number; thresholdUsd: number; status: "ok" | "near" | "over" };
    noTelemetry: boolean;
  }[];
  tools: { tool: string; totalBytes: number }[];
  signals: { duplicateReads: number; limitHits: number };
  coverage: { coworkEvents: number; toolCalls: number; unmatchedEmails: string[] };
};

export function managerSummary(r: SummaryInput): ManagerSummary {
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);

  // 1. Limit hits: any is worth a look; more than two in a week is off.
  const limitHits = r.signals.limitHits;
  const limitState: KpiState = r.coverage.coworkEvents === 0 ? "none" : limitHits === 0 ? "ok" : limitHits <= 2 ? "watch" : "off";

  // 2. Closest to the threshold.
  const ranked = r.people
    .filter((p) => p.month.thresholdUsd > 0)
    .map((p) => ({ name: p.name, pct: (p.month.costUsd / p.month.thresholdUsd) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  const closest = r.coverage.coworkEvents > 0 && ranked.length ? ranked[0] : null;

  // 3. Cache share across everyone.
  const input = sum(r.people, (p) => p.cowork.inputTokens + p.cowork.cacheReadTokens + p.cowork.cacheCreationTokens);
  const cacheShare = input > 0 ? Math.round((sum(r.people, (p) => p.cowork.cacheReadTokens) / input) * 100) : null;

  // 4. Repeat reads as a share of connector calls.
  const calls = r.coverage.toolCalls;
  const duplicateRate = calls > 0 ? round1((r.signals.duplicateReads / calls) * 100) : null;

  // 5. Requests on the heaviest model.
  const requests = sum(r.people, (p) => p.cowork.requests);
  const heavy = sum(r.people, (p) => sum(p.cowork.models.filter((m) => isHeavyModel(m.model)), (m) => m.requests));
  const heavyModelShare = requests > 0 ? Math.round((heavy / requests) * 100) : null;

  // 6. Average answer per connector call.
  const bytes = sum(r.tools, (t) => t.totalBytes);
  const avgCallKb = calls > 0 ? round1(bytes / calls / 1000) : null;

  const kpis: Kpi[] = [
    { key: "limitHits", value: r.coverage.coworkEvents === 0 ? null : limitHits, state: limitState },
    { key: "closestToThreshold", value: closest ? Math.round(closest.pct) : null, state: stateOf("closestToThreshold", closest ? closest.pct : null), ...(closest ? { who: closest.name } : {}) },
    { key: "cacheShare", value: cacheShare, state: stateOf("cacheShare", cacheShare) },
    { key: "duplicateRate", value: duplicateRate, state: stateOf("duplicateRate", duplicateRate) },
    { key: "heavyModelShare", value: heavyModelShare, state: stateOf("heavyModelShare", heavyModelShare) },
    { key: "avgCallKb", value: avgCallKb, state: stateOf("avgCallKb", avgCallKb) },
  ];

  // Things to do, most urgent first, at most three.
  const actions: SummaryAction[] = [];
  for (const p of r.people) if (p.cowork.limitHits > 0) actions.push({ key: "limitHit", values: { name: p.name, count: p.cowork.limitHits } });
  for (const p of r.people) if (p.month.status !== "ok") actions.push({ key: "nearThreshold", values: { name: p.name, cost: round1(p.month.costUsd), threshold: p.month.thresholdUsd } });
  const top = [...r.tools].sort((a, b) => b.totalBytes - a.totalBytes)[0];
  if (top && bytes > 0) {
    const share = Math.round((top.totalBytes / bytes) * 100);
    if (share >= SHORTEN_TOOL_SHARE && top.totalBytes >= SHORTEN_TOOL_MIN_KB * 1000) actions.push({ key: "shortenTool", values: { tool: top.tool, share, kb: Math.round(top.totalBytes / 1000) } });
  }
  if (heavyModelShare !== null && stateOf("heavyModelShare", heavyModelShare) === "off") actions.push({ key: "lighterModel", values: { share: heavyModelShare } });
  if (duplicateRate !== null && stateOf("duplicateRate", duplicateRate) === "off") actions.push({ key: "repeatReads", values: { rate: duplicateRate } });
  for (const p of r.people) if (p.noTelemetry) actions.push({ key: "checkTelemetry", values: { name: p.name } });

  const missing = r.coverage.coworkEvents === 0 || r.people.some((p) => p.noTelemetry) || r.coverage.unmatchedEmails.length > 0;
  // The verdict is about people: stuck, or heading past their threshold.
  // An indicator off target shows on its own card and in the actions; it
  // does not turn a quiet week into one that needs attention.
  const needsAttention = limitHits > 0 || r.people.some((p) => p.month.status !== "ok");
  const verdict: Verdict = needsAttention ? "attention" : missing ? "partial" : "ok";

  return { verdict, kpis, actions: actions.slice(0, 3) };
}
