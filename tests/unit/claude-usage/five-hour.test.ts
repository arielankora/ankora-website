import { describe, expect, it } from "vitest";
import { personFiveHour, stateOf, teamFiveHour, type PersonFiveHour } from "@/lib/claude-usage/five-hour";
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
    expect(f.current).toEqual({ state: "near", pct: 92, resetsAt: "2026-11-17T11:35:00.000Z", hitAt: null, source: "extension" });
    expect(f.weeklyPct).toBe(61);
    expect(f.week).toHaveLength(1);
    expect(f.week[0]).toMatchObject({ start: "2026-11-17T06:35:00.000Z", peakPct: 92, hit: false, measured: true });
  });

  it("a reading over an hour old says nothing about now", () => {
    const f = personFiveHour([sample("2026-11-17T08:30:00Z", 92, "2026-11-17T11:35:00Z")], [], NOW);
    expect(f.current.state).toBe("unknown");
    expect(f.weeklyPct).toBeNull();
    expect(f.week[0].peakPct).toBe(92);
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
    expect(f.current).toEqual({
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

describe("teamFiveHour", () => {
  const p = (name: string, over: Partial<PersonFiveHour["current"]>, rest: Partial<PersonFiveHour> = {}) => ({
    name,
    fiveHour: {
      current: { state: "unknown", pct: null, resetsAt: null, hitAt: null, source: null, ...over },
      weeklyPct: null,
      week: [],
      hitsThisWeek: 0,
      ...rest,
    } as PersonFiveHour,
  });
  const hitCell = (hitAt: string) => ({ start: hitAt, peakPct: 100, hit: true, hitAt, measured: true });

  it("who is stuck now, who is over 70, and the closest to the weekly limit", () => {
    const team = teamFiveHour([
      p("Anna", { state: "stuck", pct: 100, resetsAt: "2026-11-17T10:40:00Z", source: "extension" }, { weeklyPct: 77 }),
      p("Hadas", { state: "near", pct: 92, source: "extension" }, { weeklyPct: 61 }),
      p("Ariel", { state: "watch", pct: 74, source: "extension" }),
      p("Ops", { state: "free", pct: 22, source: "extension" }),
      p("Sagit", {}),
    ]);
    expect(team.stuckNow.map((x) => x.name)).toEqual(["Anna"]);
    expect(team.over70Now).toEqual([
      { name: "Hadas", pct: 92 },
      { name: "Ariel", pct: 74 },
    ]);
    expect(team.closestWeekly).toEqual({ name: "Anna", pct: 77 });
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
