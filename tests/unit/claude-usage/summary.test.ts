import { describe, expect, it } from "vitest";
import { managerSummary, type SummaryInput } from "@/lib/claude-usage/summary";
import type { Pace } from "@/lib/claude-usage/five-hour";

// The managers' summary at the top of "שימוש בקלוד" (17.11.2026). What a
// manager reads first, so each rule is pinned: the verdict, the six
// leading indicators against their targets, and what to do this week.

type Person = SummaryInput["people"][number];
const person = (over: Partial<Person> & { name: string }): Person => ({
  cowork: { requests: 10, inputTokens: 100, cacheReadTokens: 900, cacheCreationTokens: 0, limitHits: 0, models: [{ model: "claude-sonnet-5-5", requests: 10 }] },
  connector: { calls: 10 },
  noTelemetry: false,
  ...over,
});

const base = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  people: [person({ name: "Hadas" }), person({ name: "Ariel" })],
  tools: [
    { tool: "get_task", totalBytes: 50_000 },
    { tool: "get_client_brief", totalBytes: 50_000 },
  ],
  signals: { duplicateReads: 0, limitHits: 0 },
  coverage: { coworkEvents: 40, toolCalls: 20, unmatchedEmails: [] },
  ...over,
});

const kpi = (s: ReturnType<typeof managerSummary>, key: string) => s.kpis.find((k) => k.key === key)!;

describe("managerSummary", () => {
  it("says all is well on a quiet week with every indicator on target", () => {
    const s = managerSummary(base());
    expect(s.verdict).toBe("ok");
    // Every indicator with data is on target; the weekly limit has none
    // until the extension reports.
    expect(s.kpis.every((k) => k.state === "ok" || k.key === "weeklyPace")).toBe(true);
    expect(s.actions).toEqual([]);
  });

  it("computes the four indicators", () => {
    const s = managerSummary(base({ signals: { duplicateReads: 1, limitHits: 0 } }));
    expect(kpi(s, "limitHits").value).toBe(0);
    expect(kpi(s, "weeklyPace")).toMatchObject({ value: null, state: "none" });
    expect(kpi(s, "cacheShare").value).toBe(90);
    expect(kpi(s, "duplicateRate")).toMatchObject({ value: 5, state: "watch" });
    expect(kpi(s, "avgCallKb")).toMatchObject({ value: 5, state: "ok" });
  });

  it("needs attention when someone got stuck, and says who", () => {
    const stuck = managerSummary(base({ people: [person({ name: "Hadas", cowork: { ...person({ name: "x" }).cowork, limitHits: 2 } })], signals: { duplicateReads: 0, limitHits: 2 } }));
    expect(stuck.verdict).toBe("attention");
    expect(stuck.actions[0]).toEqual({ key: "limitHit", values: { name: "Hadas", count: 2 } });
  });

  it("an indicator off target becomes an action, not a verdict", () => {
    const s = managerSummary(base({ signals: { duplicateReads: 3, limitHits: 0 } }));
    expect(kpi(s, "duplicateRate")).toMatchObject({ value: 15, state: "off" });
    expect(s.verdict).toBe("ok");
    expect(s.actions).toContainEqual({ key: "repeatReads", values: { rate: 15 } });
  });

  it("never compares the cost estimate with a seat, nor points at a lighter model (18.11.2026)", () => {
    const opus = person({ name: "Ariel", cowork: { ...person({ name: "x" }).cowork, requests: 2000, models: [{ model: "claude-opus-5-5", requests: 2000 }] } });
    const s = managerSummary(base({ people: [opus] }));
    expect(s.verdict).toBe("ok");
    expect(s.kpis.map((k) => k.key)).toEqual(["limitHits", "weeklyPace", "cacheShare", "duplicateRate", "avgCallKb"]);
    expect(s.actions).toEqual([]);
  });

  it("names the tool to shorten when one sends most of the connector's bytes", () => {
    const s = managerSummary(base({ tools: [{ tool: "get_proposal_stats", totalBytes: 386_000 }, { tool: "get_task", totalBytes: 141_000 }] }));
    expect(s.actions).toContainEqual({ key: "shortenTool", values: { tool: "get_proposal_stats", share: 73, kb: 386 } });
  });

  it("is partial when data is missing, and asks to check the person", () => {
    const s = managerSummary(base({ people: [person({ name: "Hadas" }), person({ name: "Anna", noTelemetry: true })] }));
    expect(s.verdict).toBe("partial");
    expect(s.actions).toContainEqual({ key: "checkTelemetry", values: { name: "Anna" } });
  });

  it("shows no figures, rather than zeros, before any telemetry arrived", () => {
    const s = managerSummary(base({ coverage: { coworkEvents: 0, toolCalls: 0, unmatchedEmails: [] }, people: [], tools: [] }));
    expect(s.kpis.map((k) => k.state)).toEqual(["none", "none", "none", "none", "none"]);
    expect(s.verdict).toBe("partial");
  });

  it("gives at most three actions", () => {
    const people = ["A", "B", "C", "D"].map((name) => person({ name, noTelemetry: true }));
    expect(managerSummary(base({ people })).actions).toHaveLength(3);
  });
});

describe("managerSummary with the browser extension's readings (way 3)", () => {
  const limits = (week: number | null, hits = 0) => ({
    current: { fiveHourPct: 10, sevenDayPct: week },
    lastReadingAt: "2026-11-17T11:50:00.000Z",
    fiveHourLimitHits: hits,
    weeklyLimitHits: 0,
  });

  const weekly = (over: Partial<Pace>): Pace => ({ usedPct: 50, elapsedPct: 50, projectedPct: 100, state: "watch", projectedHitAt: null, resetsAt: "2026-11-20T00:00:00Z", ...over });

  it("reads the weekly limit against the time gone: ahead of the pace needs attention, a high share near the reset does not", () => {
    const s = managerSummary(
      base({
        people: [
          // 87% with 95% of the week gone: on track for 92%, worth watching only.
          person({ name: "Ariel", limits: limits(87), fiveHour: { current: { pct: 10, state: "free" }, weekly: weekly({ usedPct: 87, elapsedPct: 95, projectedPct: 92, state: "watch" }) } }),
          // 55% with 30% gone: on track for 183%, runs out before the reset.
          person({ name: "Hadas", limits: limits(55), fiveHour: { current: { pct: 10, state: "free" }, weekly: weekly({ usedPct: 55, elapsedPct: 30, projectedPct: 183, state: "over", projectedHitAt: "2026-11-19T10:00:00Z" }) } }),
        ],
        coverage: { coworkEvents: 40, toolCalls: 20, unmatchedEmails: [], limitReadings: 10 },
      })
    );
    expect(s.kpis[1]).toMatchObject({ key: "weeklyPace", value: 183, who: "Hadas", state: "off" });
    expect(s.verdict).toBe("attention");
    expect(s.actions).toContainEqual({ key: "nearWeeklyLimit", values: { name: "Hadas", pct: 55, elapsed: 30, projected: 183, hitAt: "2026-11-19T10:00:00Z" } });
    expect(s.actions.some((a) => a.key === "nearWeeklyLimit" && a.values.name === "Ariel")).toBe(false);
  });

  it("a high share near the reset alone does not need attention", () => {
    const s = managerSummary(
      base({
        people: [person({ name: "Ariel", limits: limits(87), fiveHour: { current: { pct: 10, state: "free" }, weekly: weekly({ usedPct: 87, elapsedPct: 95, projectedPct: 92, state: "watch" }) } })],
        coverage: { coworkEvents: 40, toolCalls: 20, unmatchedEmails: [], limitReadings: 10 },
      })
    );
    expect(s.kpis[1]).toMatchObject({ value: 92, state: "watch" });
    expect(s.verdict).toBe("ok");
  });

  it("counts a limit hit the extension saw, without adding it to Cowork's own count", () => {
    const hadas = person({ name: "Hadas", limits: limits(30, 2), cowork: { ...person({ name: "x" }).cowork, limitHits: 1 } });
    const s = managerSummary(base({ people: [hadas], signals: { duplicateReads: 0, limitHits: 1 }, coverage: { coworkEvents: 40, toolCalls: 20, unmatchedEmails: [], limitReadings: 5 } }));
    expect(s.kpis[0]).toMatchObject({ key: "limitHits", value: 2 });
    expect(s.actions[0]).toEqual({ key: "limitHit", values: { name: "Hadas", count: 2 } });
  });

  it("once the extension reports for anyone, asks to check it for an active person it never reported for", () => {
    const s = managerSummary(
      base({
        people: [person({ name: "Hadas", limits: limits(20) }), person({ name: "Sagit" })],
        coverage: { coworkEvents: 40, toolCalls: 20, unmatchedEmails: [], limitReadings: 3 },
      })
    );
    expect(s.actions).toContainEqual({ key: "checkExtension", values: { name: "Sagit" } });
    expect(s.verdict).toBe("partial");
  });

  it("asks nothing about the extension before it is rolled out", () => {
    const s = managerSummary(base());
    expect(s.actions.some((a) => a.key === "checkExtension")).toBe(false);
    expect(s.kpis[1]).toMatchObject({ key: "weeklyPace", value: null, state: "none" });
  });
});

describe("managerSummary and extension readings with no person", () => {
  it("asks to match the address, and says data is missing", () => {
    const s = managerSummary(base({ coverage: { coworkEvents: 40, toolCalls: 20, unmatchedEmails: [], limitReadings: 3, unmatchedLimitEmails: ["facufacu@ankora.co.il"] } }));
    expect(s.verdict).toBe("partial");
    expect(s.actions).toContainEqual({ key: "unmatchedLimits", values: { emails: "facufacu@ankora.co.il", count: 1 } });
  });
});

describe("managerSummary and the five-hour window", () => {
  it("someone close to stuck now is the first thing to do, and needs attention", () => {
    const s = managerSummary(
      base({
        people: [
          person({ name: "Hadas", fiveHour: { current: { pct: 92.4, state: "near" } } }),
          person({ name: "Ariel", fiveHour: { current: { pct: 74, state: "watch" } } }),
        ],
      })
    );
    expect(s.verdict).toBe("attention");
    expect(s.actions[0]).toEqual({ key: "nearFiveHour", values: { name: "Hadas", pct: 92, hitAt: "" } });
    expect(s.actions.some((a) => a.values.name === "Ariel")).toBe(false);
  });
});
