import { describe, expect, it } from "vitest";
import {
  ankoraToolFor,
  briefThenFile,
  duplicateReads,
  fiveHourWindows,
  heaviestWindow,
  isLimitHit,
  requestsBySource,
  seatStatus,
  type CoworkEventIn,
  type ToolCallIn,
} from "@/lib/claude-usage/report-math";

// Claude usage measurement, stage 3 (17.11.2026): the rules behind the
// "שימוש בקלוד" screen. Each one decides what a manager is told about a
// person, so each is pinned here.

const at = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00Z`);

const ev = (over: Partial<CoworkEventIn>): CoworkEventIn => ({
  eventName: "api_request",
  userId: "u1",
  occurredAt: at("08:00"),
  promptId: null,
  model: "claude-sonnet-5",
  costUsd: 0.1,
  inputTokens: 100,
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

const call = (over: Partial<ToolCallIn>): ToolCallIn => ({
  userId: "u1",
  tool: "get_task",
  ok: true,
  resultBytes: 1000,
  resultChars: 1000,
  imageCount: 0,
  truncated: false,
  argsHash: "aaaa",
  createdAt: at("08:00"),
  ...over,
});

describe("isLimitHit", () => {
  it("is an API error with 429, or one that names the limit", () => {
    expect(isLimitHit({ eventName: "api_error", statusCode: "429", errorText: null })).toBe(true);
    expect(isLimitHit({ eventName: "api_error", statusCode: "undefined", errorText: "Usage limit reached for this window" })).toBe(true);
    expect(isLimitHit({ eventName: "api_error", statusCode: "500", errorText: "overloaded" })).toBe(false);
    expect(isLimitHit({ eventName: "api_request", statusCode: "429", errorText: null })).toBe(false);
  });
});

describe("fiveHourWindows", () => {
  it("starts a window at the first request and a new one five hours later", () => {
    const windows = fiveHourWindows([
      ev({ occurredAt: at("08:00"), costUsd: 1 }),
      ev({ occurredAt: at("12:59"), costUsd: 2 }),
      ev({ occurredAt: at("13:00"), costUsd: 4 }),
      ev({ eventName: "api_error", statusCode: "429", occurredAt: at("14:00") }),
      ev({ eventName: "tool_result", occurredAt: at("23:00") }),
    ]);
    expect(windows.map((w) => [w.start.toISOString(), w.costUsd, w.requests, w.limitHits])).toEqual([
      [at("08:00").toISOString(), 3, 2, 0],
      [at("13:00").toISOString(), 4, 1, 1],
    ]);
    expect(heaviestWindow(windows)?.costUsd).toBe(4);
  });

  it("orders events itself", () => {
    const windows = fiveHourWindows([ev({ occurredAt: at("13:00") }), ev({ occurredAt: at("08:00") })]);
    expect(windows).toHaveLength(2);
    expect(heaviestWindow([])).toBeNull();
  });
});

describe("duplicateReads", () => {
  const readOnly = (t: string) => t !== "create_task";

  it("counts the same read by the same person within half an hour", () => {
    const dups = duplicateReads(
      [
        call({ createdAt: at("08:00") }),
        call({ createdAt: at("08:10") }),
        call({ createdAt: at("09:00") }),
        call({ createdAt: at("08:05"), userId: "u2" }),
        call({ createdAt: at("08:06"), argsHash: "bbbb" }),
      ],
      readOnly
    );
    expect(dups.get("get_task")).toBe(1);
  });

  it("leaves writes and failures out", () => {
    const dups = duplicateReads(
      [call({ tool: "create_task" }), call({ tool: "create_task" }), call({ ok: false }), call({ ok: false })],
      readOnly
    );
    expect(dups.size).toBe(0);
  });
});

describe("briefThenFile", () => {
  it("counts a brief followed by the whole file within 15 minutes", () => {
    expect(
      briefThenFile([
        call({ tool: "get_client_brief", createdAt: at("08:00") }),
        call({ tool: "get_client_file", createdAt: at("08:10") }),
        call({ tool: "get_client_file", createdAt: at("08:12") }),
        call({ tool: "get_client_brief", createdAt: at("09:00") }),
        call({ tool: "get_client_file", createdAt: at("09:30") }),
        call({ tool: "get_client_brief", createdAt: at("10:00"), userId: "u2" }),
        call({ tool: "get_client_file", createdAt: at("10:01") }),
      ])
    ).toBe(1);
  });
});

describe("ankoraToolFor", () => {
  const tool = (over: Partial<CoworkEventIn>) => ev({ eventName: "tool_result", toolName: "mcp_tool", toolResultBytes: 48_000, occurredAt: at("08:00"), ...over });

  it("takes the name Cowork sent when there is one", () => {
    expect(ankoraToolFor(tool({ mcpTool: "get_process" }), [])).toBe("get_process");
  });

  it("matches our own log by time and size, closest first", () => {
    const calls = [
      call({ tool: "get_client_file", resultBytes: 48_100, createdAt: new Date(at("08:00").getTime() - 3_000) }),
      call({ tool: "get_task", resultBytes: 48_000, createdAt: new Date(at("08:00").getTime() - 60_000) }),
    ];
    expect(ankoraToolFor(tool({}), calls)).toBe("get_client_file");
  });

  it("returns nothing when the size or the time is off", () => {
    expect(ankoraToolFor(tool({}), [call({ resultBytes: 20_000 })])).toBeNull();
    expect(ankoraToolFor(tool({}), [call({ resultBytes: 48_000, createdAt: at("08:05") })])).toBeNull();
    expect(ankoraToolFor(tool({ toolName: "Bash" }), [call({ resultBytes: 48_000 })])).toBeNull();
  });
});

describe("seatStatus", () => {
  it("is over past the threshold, near when the pace would pass it, ok otherwise", () => {
    expect(seatStatus({ monthCostUsd: 25, seatUsd: 20, multiplier: 1, measuredDays: 17, daysLeft: 13 }).status).toBe("over");
    expect(seatStatus({ monthCostUsd: 15, seatUsd: 20, multiplier: 1, measuredDays: 15, daysLeft: 15 })).toEqual({ status: "near", thresholdUsd: 20, projectedUsd: 30 });
    expect(seatStatus({ monthCostUsd: 5, seatUsd: 20, multiplier: 1, measuredDays: 15, daysLeft: 15 }).status).toBe("ok");
    expect(seatStatus({ monthCostUsd: 150, seatUsd: 100, multiplier: 2, measuredDays: 30, daysLeft: 0 }).status).toBe("ok");
  });

  it("counts the pace from when measurement began, not from the first of the month", () => {
    // Telemetry started on the 17th; four days later $8 was spent.
    // Over 4 measured days that is $2 a day, so $8 + 9 days × $2 = $26.
    expect(seatStatus({ monthCostUsd: 8, seatUsd: 20, multiplier: 1, measuredDays: 4, daysLeft: 9 })).toEqual({ status: "near", thresholdUsd: 20, projectedUsd: 26 });
  });

  it("states no pace before three days of measurement", () => {
    expect(seatStatus({ monthCostUsd: 1, seatUsd: 20, multiplier: 1, measuredDays: 0.02, daysLeft: 13 })).toEqual({ status: "ok", thresholdUsd: 20, projectedUsd: null });
    // Already past the threshold is "over" whatever the pace.
    expect(seatStatus({ monthCostUsd: 30, seatUsd: 20, multiplier: 1, measuredDays: 1, daysLeft: 13 }).status).toBe("over");
  });
});

describe("requestsBySource", () => {
  it("splits API requests and cost by product, busiest first", () => {
    const split = requestsBySource([
      ev({ source: "cowork", costUsd: 1 }),
      ev({ source: "claude-code", costUsd: 0.5 }),
      ev({ source: "claude-code", costUsd: 0.25 }),
      ev({ source: null, costUsd: 0.1 }),
      ev({ source: "claude-code", eventName: "tool_result" }),
    ]);
    expect(split).toEqual([
      { source: "claudeCode", requests: 2, costUsd: 0.75 },
      { source: "cowork", requests: 1, costUsd: 1 },
      { source: "other", requests: 1, costUsd: 0.1 },
    ]);
  });
});
