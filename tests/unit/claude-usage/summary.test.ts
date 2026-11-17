import { describe, expect, it } from "vitest";
import { managerSummary, type SummaryInput } from "@/lib/claude-usage/summary";

// The managers' summary at the top of "שימוש בקלוד" (17.11.2026). What a
// manager reads first, so each rule is pinned: the verdict, the six
// leading indicators against their targets, and what to do this week.

type Person = SummaryInput["people"][number];
const person = (over: Partial<Person> & { name: string }): Person => ({
  cowork: { requests: 10, inputTokens: 100, cacheReadTokens: 900, cacheCreationTokens: 0, limitHits: 0, models: [{ model: "claude-sonnet-5-5", requests: 10 }] },
  connector: { calls: 10 },
  month: { costUsd: 1, thresholdUsd: 20, status: "ok" },
  noTelemetry: false,
  ...over,
});

const base = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  people: [person({ name: "Hadas" }), person({ name: "Ariel", month: { costUsd: 0.68, thresholdUsd: 100, status: "ok" } })],
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
    expect(s.kpis.every((k) => k.state === "ok")).toBe(true);
    expect(s.actions).toEqual([]);
  });

  it("computes the six indicators", () => {
    const s = managerSummary(base({ signals: { duplicateReads: 1, limitHits: 0 } }));
    expect(kpi(s, "limitHits").value).toBe(0);
    expect(kpi(s, "closestToThreshold")).toMatchObject({ value: 5, who: "Hadas", state: "ok" });
    expect(kpi(s, "cacheShare").value).toBe(90);
    expect(kpi(s, "duplicateRate")).toMatchObject({ value: 5, state: "watch" });
    expect(kpi(s, "heavyModelShare")).toMatchObject({ value: 0, state: "ok" });
    expect(kpi(s, "avgCallKb")).toMatchObject({ value: 5, state: "ok" });
  });

  it("needs attention when someone got stuck or is heading past their threshold, and says who", () => {
    const stuck = managerSummary(base({ people: [person({ name: "Hadas", cowork: { ...person({ name: "x" }).cowork, limitHits: 2 } })], signals: { duplicateReads: 0, limitHits: 2 } }));
    expect(stuck.verdict).toBe("attention");
    expect(stuck.actions[0]).toEqual({ key: "limitHit", values: { name: "Hadas", count: 2 } });

    const near = managerSummary(base({ people: [person({ name: "Hadas", month: { costUsd: 17, thresholdUsd: 20, status: "near" } })] }));
    expect(near.verdict).toBe("attention");
    expect(near.actions[0]).toMatchObject({ key: "nearThreshold", values: { name: "Hadas" } });
  });

  it("an indicator off target becomes an action, not a verdict", () => {
    const opus = person({ name: "Ariel", cowork: { ...person({ name: "x" }).cowork, models: [{ model: "claude-opus-5-5", requests: 10 }] } });
    const s = managerSummary(base({ people: [opus] }));
    expect(kpi(s, "heavyModelShare")).toMatchObject({ value: 100, state: "off" });
    expect(s.verdict).toBe("ok");
    expect(s.actions).toContainEqual({ key: "lighterModel", values: { share: 100 } });
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
    expect(s.kpis.map((k) => k.state)).toEqual(["none", "none", "none", "none", "none", "none"]);
    expect(s.verdict).toBe("partial");
  });

  it("gives at most three actions", () => {
    const people = ["A", "B", "C", "D"].map((name) => person({ name, noTelemetry: true }));
    expect(managerSummary(base({ people })).actions).toHaveLength(3);
  });
});
