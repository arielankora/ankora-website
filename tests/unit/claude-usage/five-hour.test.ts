import { describe, expect, it } from "vitest";
import { paceOf, personFiveHour, stateOf, teamFiveHour, MIN_ELAPSED_FIVE_MS, MIN_ELAPSED_WEEK_MS, WEEK_LIMIT_MS, type Pace, type PersonFiveHour } from "@/lib/claude-usage/five-hour";
import { WINDOW_MS } from "@/lib/claude-usage/report-math";
import type { CoworkEventIn } from "@/lib/claude-usage/report-math";
import type { LimitSampleIn } from "@/lib/claude-usage/limits";

// The five-hour window at the top of "שימוש בקלוד" (17.11.2026, design
// option ג). People get stuck here, not on the monthly threshold, so each
// rule that decides "stuck", "close" and the week's squares is pinned.

const NOW = new Date("2026-11-17T10:00:00Z");
const at = (iso: string) => new Date(iso);
const H = 3_600_000;

const sample = (observed: string, pct: number | null, resets: string | null, week: number | null = 40): LimitSampleIn => ({
  userId: "u1",
  fiveHourPct: pct,
  fiveHourResetsAt: resets ? at(resets) : null,
  sevenDayPct: week,
  sevenDayResetsAt: at("2026-11-20T00:00:00Z"),
  observedAt: at(observed),
});

const ev = (iso: string, over: Partial<CoworkEventIn> = {}): CoworkEventIn => ({
  eventName: "api_request",
  userId: "u1",
  occurredAt: at(iso),
  promptId: null,
  model: "claude-sonnet-5-5",
  costUsd: 0.1,
  inputTokens: 10,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  statusCode: null,
  errorText: null,
  toolName: null,
  toolResultBytes: null,
  mcpTool: null,
  ...over,
});
const hit = (iso: string) => ev(iso, { eventName: "api_error", statusCode: "429", costUsd: null });

describe("stateOf", () => {
  it("bands the share at 70, 90 and 100", () => {
    expect(stateOf(null)).toBe("unknown");
    expect(stateOf(0)).toBe("idle");
    expect(stateOf(40)).toBe("free");
    expect(stateOf(70)).toBe("watch");
    expect(stateOf(90)).toBe("near");
    expect(stateOf(100)).toBe("stuck");
  });
});

describe("personFiveHour", () => {
  it("takes the current window from a fresh extension reading", () => {
    const f = personFiveHour([sample("2026-11-17T09:50:00Z", 92, "2026-11-17T11:35:00Z", 61)], [], NOW);
    expect(f.current).toMatchObject({ state: "near", pct: 92, resetsAt: "2026-11-17T11:35:00.000Z", hitAt: null, source: "extension" });
    expect(f.weeklyPct).toBe(61);
    expect(f.week).toHaveLength(1);
    expect(f.week[0]).toMatchObject({ start: "2026-11-17T06:35:00.000Z", peakPct: 92, hit: false, measured: true });
  });

  it("a reading over an hour old is kept, marked stale, and read as of when it was taken (19.11.2026)", () => {
    const f = personFiveHour([sample("2026-11-17T08:30:00Z", 92, "2026-11-17T11:35:00Z")], [], NOW);
    expect(f.reading).toEqual({ observedAt: "2026-11-17T08:30:00.000Z", stale: true, windowReset: false });
    expect(f.current.pct).toBe(92);
    expect(f.current.state).not.toBe("unknown");
    // As of 08:30: 1:55 of the window had gone, not 3:25.
    expect(f.current.pace?.elapsedPct).toBeCloseTo(38.3, 0);
    expect(f.weeklyPct).toBe(40);
    expect(f.weekly?.usedPct).toBe(40);
    expect(f.week[0].peakPct).toBe(92);
  });

  it("a stale reading whose window reset since leaves the window unknown, and keeps the week", () => {
    const f = personFiveHour([sample("2026-11-17T08:30:00Z", 70, "2026-11-17T09:00:00Z", 70)], [], NOW);
    expect(f.reading).toMatchObject({ stale: true, windowReset: true });
    expect(f.current.state).toBe("unknown");
    expect(f.current.pct).toBeNull();
    expect(f.weeklyPct).toBe(70);
  });

  it("a reading over a day old says nothing about now", () => {
    const f = personFiveHour([sample("2026-11-16T08:30:00Z", 92, "2026-11-16T11:35:00Z")], [], NOW);
    expect(f.reading).toBeNull();
    expect(f.current.state).toBe("unknown");
    expect(f.weeklyPct).toBeNull();
  });

  it("a window that already reset is no open window", () => {
    const f = personFiveHour([sample("2026-11-17T09:50:00Z", 80, "2026-11-17T09:55:00Z")], [], NOW);
    expect(f.current).toMatchObject({ state: "idle", pct: 0, resetsAt: null });
  });

  it("one square per window, its peak, and when the limit was hit", () => {
    const f = personFiveHour(
      [
        sample("2026-11-16T07:00:00Z", 40, "2026-11-16T11:00:00Z"),
        sample("2026-11-16T08:20:00Z", 100, "2026-11-16T11:00:00Z"),
        sample("2026-11-16T09:00:00Z", 100, "2026-11-16T11:00:00Z"),
        sample("2026-11-16T13:00:00Z", 30, "2026-11-16T17:00:00Z"),
      ],
      [],
      NOW
    );
    expect(f.week.map((w) => [w.peakPct, w.hit])).toEqual([
      [100, true],
      [30, false],
    ]);
    expect(f.week[0].hitAt).toBe("2026-11-16T08:20:00.000Z");
    expect(f.hitsThisWeek).toBe(1);
  });

  it("drops windows older than a week", () => {
    const f = personFiveHour([sample("2026-11-09T07:00:00Z", 100, "2026-11-09T11:00:00Z")], [], NOW);
    expect(f.week).toEqual([]);
  });

  it("without the extension, a Cowork 429 marks the window stuck and estimates the reset", () => {
    const f = personFiveHour([], [ev("2026-11-17T07:00:00Z"), hit("2026-11-17T09:20:00Z")], NOW);
    expect(f.current).toMatchObject({
      state: "stuck",
      pct: 100,
      resetsAt: new Date(at("2026-11-17T07:00:00Z").getTime() + 5 * H).toISOString(),
      hitAt: "2026-11-17T09:20:00.000Z",
      source: "cowork",
    });
    expect(f.week).toEqual([{ start: "2026-11-17T07:00:00.000Z", peakPct: 100, hit: true, hitAt: "2026-11-17T09:20:00.000Z", measured: false }]);
  });

  it("a Cowork window with no hit and no reading shows, its share unknown", () => {
    const f = personFiveHour([], [ev("2026-11-16T07:00:00Z")], NOW);
    expect(f.current.state).toBe("unknown");
    expect(f.week[0]).toMatchObject({ peakPct: null, hit: false, measured: false });
  });

  it("a window both sources saw is shown once, with the extension's share and Cowork's hit", () => {
    const f = personFiveHour(
      [sample("2026-11-16T09:00:00Z", 85, "2026-11-16T12:00:00Z")],
      [ev("2026-11-16T07:05:00Z"), hit("2026-11-16T09:30:00Z")],
      NOW
    );
    expect(f.week).toHaveLength(1);
    expect(f.week[0]).toMatchObject({ peakPct: 100, hit: true, measured: true, hitAt: "2026-11-16T09:30:00.000Z" });
  });
});

describe("paceOf", () => {
  const NOW_P = new Date("2026-11-18T12:00:00Z");
  const inMs = (ms: number) => new Date(NOW_P.getTime() + ms);
  const H = 3_600_000;

  it("87% of the week with a day left is on pace; with five days left it runs out", () => {
    const late = paceOf(87, inMs(24 * H), NOW_P, WEEK_LIMIT_MS, MIN_ELAPSED_WEEK_MS)!;
    expect(late).toMatchObject({ elapsedPct: 85.7, projectedPct: 102, state: "over" });
    expect(late.projectedHitAt).not.toBeNull();
    const ok = paceOf(87, inMs(6 * H), NOW_P, WEEK_LIMIT_MS, MIN_ELAPSED_WEEK_MS)!;
    expect(ok).toMatchObject({ projectedPct: 90, state: "watch", projectedHitAt: null });
    const early = paceOf(87, inMs(5 * 24 * H), NOW_P, WEEK_LIMIT_MS, MIN_ELAPSED_WEEK_MS)!;
    expect(early.state).toBe("over");
    // At this rate the rest lasts about 0.3 days: before the reset.
    expect(Date.parse(early.projectedHitAt!)).toBeLessThan(NOW_P.getTime() + 5 * 24 * H);
  });

  it("is on pace at 80% projected or less, and watches up to 100%", () => {
    expect(paceOf(40, inMs(2.5 * H), NOW_P, WINDOW_MS, MIN_ELAPSED_FIVE_MS)).toMatchObject({ elapsedPct: 50, projectedPct: 80, state: "ok" });
    expect(paceOf(45, inMs(2.5 * H), NOW_P, WINDOW_MS, MIN_ELAPSED_FIVE_MS)).toMatchObject({ projectedPct: 90, state: "watch" });
  });

  it("is too early to project in the first half hour of a window, or the first day of a week", () => {
    expect(paceOf(20, inMs(4.75 * H), NOW_P, WINDOW_MS, MIN_ELAPSED_FIVE_MS)).toMatchObject({ projectedPct: null, state: "early" });
    expect(paceOf(20, inMs(6.5 * 24 * H), NOW_P, WEEK_LIMIT_MS, MIN_ELAPSED_WEEK_MS)).toMatchObject({ state: "early" });
  });

  it("is not early once half the limit is used: 68% of the week after 17 hours runs out", () => {
    const week = paceOf(68, inMs(7 * 24 * H - 17 * H), NOW_P, WEEK_LIMIT_MS, MIN_ELAPSED_WEEK_MS)!;
    expect(week.state).toBe("over");
    expect(week.projectedPct).toBeGreaterThan(100);
    // 32% left at 4% an hour: about 8 hours.
    expect(Date.parse(week.projectedHitAt!) - NOW_P.getTime()).toBeCloseTo(8 * H, -5);
    expect(paceOf(55, inMs(4.75 * H), NOW_P, WINDOW_MS, MIN_ELAPSED_FIVE_MS)).toMatchObject({ state: "over" });
    expect(paceOf(49, inMs(6.5 * 24 * H), NOW_P, WEEK_LIMIT_MS, MIN_ELAPSED_WEEK_MS)).toMatchObject({ state: "early" });
  });

  it("says stuck at 100%, and nothing without a reset time", () => {
    expect(paceOf(100, inMs(H), NOW_P, WINDOW_MS, MIN_ELAPSED_FIVE_MS)?.state).toBe("stuck");
    expect(paceOf(50, null, NOW_P, WINDOW_MS, MIN_ELAPSED_FIVE_MS)).toBeNull();
  });
});

describe("teamFiveHour", () => {
  const p = (name: string, over: Partial<PersonFiveHour["current"]>, rest: Partial<PersonFiveHour> = {}) => ({
    name,
    fiveHour: {
      current: { state: "unknown", pct: null, resetsAt: null, hitAt: null, source: null, pace: null, ...over },
      weeklyPct: null,
      weekly: null,
      week: [],
      hitsThisWeek: 0,
      reading: over.source === "extension" ? { observedAt: "2026-11-17T09:55:00Z", stale: false, windowReset: false } : null,
      ...rest,
    } as PersonFiveHour,
  });
  const hitCell = (hitAt: string) => ({ start: hitAt, peakPct: 100, hit: true, hitAt, measured: true });

  const pace = (over: Partial<Pace>): Pace => ({ usedPct: 50, elapsedPct: 50, projectedPct: 100, state: "watch", projectedHitAt: null, resetsAt: "2026-11-20T00:00:00Z", ...over });

  it("who is stuck now, who is ahead of the window's pace, and who is furthest ahead of the week's", () => {
    const team = teamFiveHour([
      p("Anna", { state: "stuck", pct: 100, resetsAt: "2026-11-17T10:40:00Z", source: "extension" }, { weekly: pace({ usedPct: 77, projectedPct: 90 }) }),
      p("Hadas", { state: "near", pct: 40, source: "extension", pace: pace({ usedPct: 40, elapsedPct: 20, projectedPct: 200, state: "over", projectedHitAt: "2026-11-17T11:00:00Z" }) }, { weekly: pace({ usedPct: 61, projectedPct: 140, state: "over" }) }),
      p("Ariel", { state: "watch", pct: 74, source: "extension", pace: pace({ usedPct: 74, projectedPct: 90 }) }, { weekly: pace({ usedPct: 87, elapsedPct: 95, projectedPct: 92 }) }),
      p("Ops", { state: "free", pct: 22, source: "extension" }),
      p("Sagit", {}),
      // Measured, but over an hour ago: not "measured now".
      p("Maor", { state: "free", pct: 10, source: "extension" }, { reading: { observedAt: "2026-11-17T07:00:00Z", stale: true, windowReset: false } }),
    ]);
    expect(team.stuckNow.map((x) => x.name)).toEqual(["Anna"]);
    // By pace, not by share: Hadas at 40% early in the window comes first.
    expect(team.fastNow).toEqual([
      { name: "Hadas", pct: 40, projectedPct: 200, state: "near", projectedHitAt: "2026-11-17T11:00:00Z" },
      { name: "Ariel", pct: 74, projectedPct: 90, state: "watch", projectedHitAt: null },
    ]);
    // Ariel is at 87% but near the reset; Hadas at 61% is the one ahead.
    expect(team.fastestWeekly?.name).toBe("Hadas");
    expect(team.measuredNow).toBe(4);
  });

  it("names the peak hours when the hits cluster, in Israel time", () => {
    // 07:30 and 08:10 UTC are 09:30 and 10:10 in Israel: the 09:00 to 12:00 band.
    const team = teamFiveHour([
      p("Anna", {}, { week: [hitCell("2026-11-15T07:30:00Z"), hitCell("2026-11-16T08:10:00Z")], hitsThisWeek: 2 }),
      p("Hadas", {}, { week: [hitCell("2026-11-16T07:50:00Z")], hitsThisWeek: 1 }),
    ]);
    expect(team.hitsThisWeek).toBe(3);
    expect(team.peakHours).toEqual({ from: 9, to: 12, hits: 3 });
  });

  it("no peak hours from a single hit or scattered ones", () => {
    expect(teamFiveHour([p("Anna", {}, { week: [hitCell("2026-11-15T07:30:00Z")], hitsThisWeek: 1 })]).peakHours).toBeNull();
    expect(
      teamFiveHour([p("Anna", {}, { week: [hitCell("2026-11-15T01:00:00Z"), hitCell("2026-11-15T07:30:00Z"), hitCell("2026-11-15T14:00:00Z")], hitsThisWeek: 3 })]).peakHours
    ).toBeNull();
  });
});
