import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestUser } from "./factories";
import { claudeUsageSettings, getClaudeUsageReport, updateClaudeUsageSettings } from "@/lib/app-domain/claude-usage";

// Claude usage measurement, stage 3 (17.11.2026): the report behind the
// "שימוש בקלוד" screen and get_claude_usage, through the connector as
// Claude calls it. A super admin gets the numbers; anyone else gets the
// domain's refusal in its own words, never "unexpected server error".

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
type Validated = { value?: unknown; issues?: readonly { message: string }[] };
type Schema = { "~standard"?: { validate: (v: unknown) => Validated | Promise<Validated> } };
const tools = new Map<string, { schema: Schema; handler: Handler }>();
registerAnkoraTools({ registerTool: (name: string, c: { inputSchema: Schema }, h: Handler) => tools.set(name, { schema: c.inputSchema, handler: h }) } as never);

async function call(user: User, name: string, args: unknown) {
  const tool = tools.get(name)!;
  const validated = await tool.schema["~standard"]!.validate(args);
  if (validated.issues) throw new Error(`schema refused ${name}: ${validated.issues.map((i) => i.message).join("; ")}`);
  return tool.handler(validated.value, { http: { authInfo: { extra: { user } } } });
}

const NOW = new Date("2026-11-17T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

async function seed() {
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const call = (tool: string, minutesAgo: number, resultBytes: number, argsHash = "a1") => ({
    userId: hadas.id,
    tool,
    ok: true,
    resultBytes,
    resultChars: resultBytes,
    argsHash,
    durationMs: 50,
    createdAt: ago(minutesAgo),
  });
  await prisma.mcpToolCall.createMany({
    data: [
      call("get_client_brief", 60, 2_000, "b1"),
      call("get_client_file", 55, 48_000, "f1"),
      call("get_client_file", 50, 48_000, "f1"),
      { ...call("read_document", 40, 240_000, "d1"), truncated: true },
    ],
  });
  const ev = (over: { dedupeKey: string } & Record<string, unknown>) => ({ eventName: "api_request", userId: hadas.id, occurredAt: ago(55), promptId: "p1", model: "claude-sonnet-5", ...over });
  await prisma.coworkEvent.createMany({
    data: [
      ev({ dedupeKey: "1", costUsd: 3.5, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 9000 }),
      ev({ dedupeKey: "2", costUsd: 1.5, inputTokens: 500, outputTokens: 100, cacheReadTokens: 0, occurredAt: ago(50), source: "claude-code" }),
      ev({ dedupeKey: "3", eventName: "tool_result", toolName: "mcp_tool", toolResultBytes: 48_000, occurredAt: ago(55) }),
      ev({ dedupeKey: "4", eventName: "api_error", statusCode: "429", errorText: "rate_limit_error", occurredAt: ago(30) }),
      ev({ dedupeKey: "5", userId: null, userEmail: "guest@example.com", promptId: "p2", costUsd: 0.1 }),
    ],
  });
  await prisma.claudePromptCopy.createMany({ data: [{ userId: hadas.id, kind: "advance_plan", chars: 9000, createdAt: ago(70) }] });
  return { ariel, hadas };
}

describe("the Claude usage report", () => {
  it("adds up each person's Cowork use, connector use and prompts, and finds the waste", async () => {
    const { ariel, hadas } = await seed();
    const report = await getClaudeUsageReport(ariel, { days: 7, now: NOW });

    const h = report.people.find((p) => p.userId === hadas.id)!;
    expect(h.cowork).toMatchObject({ requests: 2, costUsd: 5, inputTokens: 1500, cacheReadTokens: 9000, limitHits: 1 });
    expect(h.cowork.cacheSharePct).toBe(86);
    expect(h.cowork.heaviestWindow).toMatchObject({ costUsd: 5, requests: 2, limitHits: 1 });
    expect(h.connector).toMatchObject({ calls: 4, bytes: 338_000 });
    expect(h.prompts).toEqual({ copies: 1, chars: 9000 });
    expect(h.seatUsd).toBe(20);
    expect(h.noTelemetry).toBe(false);
    // A tie on requests goes to the higher cost.
    expect(h.cowork.bySource).toEqual([
      { source: "other", requests: 1, costUsd: 3.5 },
      { source: "claudeCode", requests: 1, costUsd: 1.5 },
    ]);

    expect(report.tools[0]).toMatchObject({ tool: "read_document", truncated: 1 });
    expect(report.tools.find((t) => t.tool === "get_client_file")).toMatchObject({ calls: 2, duplicates: 1 });
    expect(report.signals).toEqual({ briefThenFile: 1, duplicateReads: 1, truncatedAnswers: 1, limitHits: 1 });
    expect(report.heaviestRequests[0]).toMatchObject({ promptId: "p1", costUsd: 5, requests: 2, ankoraTools: ["get_client_file"] });
    expect(report.prompts).toEqual([{ kind: "advance_plan", copies: 1, avgChars: 9000, maxChars: 9000 }]);
    expect(report.coverage.unmatchedEmails).toEqual(["guest@example.com"]);

    // The managers' summary reads the same numbers: a limit hit makes the
    // week one that needs attention, and names who to look at.
    expect(report.summary.verdict).toBe("attention");
    expect(report.summary.kpis.find((k) => k.key === "limitHits")).toMatchObject({ value: 1, state: "watch" });
    expect(report.summary.actions[0]).toMatchObject({ key: "limitHit", values: { count: 1 } });
  });

  it("lists active staff only, and dates the month from when measurement began", async () => {
    const { ariel, hadas } = await seed();
    const { user: invited } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "INVITED" });
    const { user: suspended } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "SUSPENDED" });
    const report = await getClaudeUsageReport(ariel, { days: 7, now: NOW });
    const ids = report.people.map((p) => p.userId);
    expect(ids).toContain(hadas.id);
    expect(ids).not.toContain(invited.id);
    expect(ids).not.toContain(suspended.id);
    // The seed's first event this month is 55 minutes before NOW: too
    // little to state a pace.
    expect(report.month.measuredSince).toBe(ago(55).toISOString());
    expect(report.people.find((p) => p.userId === hadas.id)!.month.projectedUsd).toBeNull();
  });

  it("lists active staff only, and dates the month from when measurement began", async () => {
    const { ariel, hadas } = await seed();
    const { user: invited } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "INVITED" });
    const { user: suspended } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "SUSPENDED" });
    const report = await getClaudeUsageReport(ariel, { days: 7, now: NOW });
    const ids = report.people.map((p) => p.userId);
    expect(ids).toContain(hadas.id);
    expect(ids).not.toContain(invited.id);
    expect(ids).not.toContain(suspended.id);
    // The seed's first event this month is 55 minutes before NOW: too
    // little to state a pace.
    expect(report.month.measuredSince).toBe(ago(55).toISOString());
    expect(report.people.find((p) => p.userId === hadas.id)!.month.projectedUsd).toBeNull();
  });

  it("puts each person against their own seat", async () => {
    const { ariel, hadas } = await seed();
    await updateClaudeUsageSettings(ariel, { seats: { [hadas.id]: 100 }, multiplier: 1 });
    const report = await getClaudeUsageReport(ariel, { days: 7, now: NOW });
    const h = report.people.find((p) => p.userId === hadas.id)!;
    expect(h.seatUsd).toBe(100);
    expect(h.month.thresholdUsd).toBe(100);
    expect(h.month.status).toBe("ok");

    await updateClaudeUsageSettings(ariel, { seats: { [hadas.id]: null } });
    expect((await claudeUsageSettings()).seats).toEqual({});
  });

  it("does not flag missing Cowork data for someone marked as not working in Cowork", async () => {
    const { ariel } = await seed();
    const { user: ops } = await createTestUser({ role: "SUPER_ADMIN" });
    await prisma.mcpToolCall.create({ data: { userId: ops.id, tool: "get_task", ok: true, resultBytes: 10, resultChars: 10, argsHash: "c1", durationMs: 5, createdAt: ago(20) } });

    let report = await getClaudeUsageReport(ariel, { days: 7, now: NOW });
    expect(report.people.find((p) => p.userId === ops.id)).toMatchObject({ noTelemetry: true, nonCowork: false });

    await updateClaudeUsageSettings(ariel, { nonCowork: { [ops.id]: true } });
    report = await getClaudeUsageReport(ariel, { days: 7, now: NOW });
    expect(report.people.find((p) => p.userId === ops.id)).toMatchObject({ noTelemetry: false, nonCowork: true });
    expect(report.summary.actions.some((a) => a.key === "checkTelemetry" && a.values.name === ops.name)).toBe(false);

    await updateClaudeUsageSettings(ariel, { nonCowork: { [ops.id]: false } });
    expect((await claudeUsageSettings()).nonCowork).toEqual([]);
  });

  it("puts the five-hour window first: who is stuck now, who is close, and the week window by window", async () => {
    const { ariel, hadas } = await seed();
    await prisma.claudeLimitSample.createMany({
      data: [
        // Ariel: the extension read 92% ten minutes ago; the window resets in 1:35.
        { userId: ariel.id, email: "a@example.com", fiveHourPct: 92, fiveHourResetsAt: new Date(NOW.getTime() + 95 * 60_000), sevenDayPct: 61, observedAt: ago(10) },
        // Ariel, two days ago: a window that reached the limit.
        { userId: ariel.id, email: "a@example.com", fiveHourPct: 100, fiveHourResetsAt: ago(2 * 24 * 60 - 60), sevenDayPct: 40, observedAt: ago(2 * 24 * 60 + 60) },
        // Eight days ago: outside the week, even on a 30-day report.
        { userId: ariel.id, email: "a@example.com", fiveHourPct: 100, fiveHourResetsAt: ago(8 * 24 * 60), sevenDayPct: 30, observedAt: ago(8 * 24 * 60 + 60) },
      ],
    });
    const report = await getClaudeUsageReport(ariel, { days: 30, now: NOW });
    const a = report.people.find((p) => p.userId === ariel.id)!;
    const h = report.people.find((p) => p.userId === hadas.id)!;
    expect(a.fiveHour.current).toMatchObject({ state: "near", pct: 92, source: "extension" });
    expect(a.fiveHour.weeklyPct).toBe(61);
    expect(a.fiveHour.week.map((w) => w.hit)).toEqual([true, false]);
    // Hadas has no extension: Cowork's 429 half an hour ago marks her stuck now.
    expect(h.fiveHour.current).toMatchObject({ state: "stuck", source: "cowork" });
    expect(report.fiveHour.stuckNow.map((x) => x.name)).toEqual([h.name]);
    expect(report.fiveHour.over70Now).toEqual([{ name: a.name, pct: 92 }]);
    expect(report.fiveHour.hitsThisWeek).toBe(2);
    expect(report.fiveHour.closestWeekly).toEqual({ name: a.name, pct: 61 });
    expect(report.summary.actions[0]).toEqual({ key: "nearFiveHour", values: { name: a.name, pct: 92 } });

    // Claude reads the same fields through the connector (the tool runs on
    // the clock, so only the shape is checked here).
    const body = JSON.parse((await call(ariel, "get_claude_usage", { days: 7 })).content[0].text);
    expect(body.fiveHour).toMatchObject({ stuckNow: expect.any(Array), over70Now: expect.any(Array), hitsThisWeek: expect.any(Number) });
    expect(body.people.find((p: { userId: string }) => p.userId === hadas.id).fiveHour.week).toEqual(expect.any(Array));
  });

  it("refuses a seat or multiplier out of range, and writes nothing", async () => {
    const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
    await expect(updateClaudeUsageSettings(ariel, { defaultSeatUsd: 0 })).rejects.toMatchObject({ code: "claudeUsage.seatRange" });
    await expect(updateClaudeUsageSettings(ariel, { multiplier: 99 })).rejects.toMatchObject({ code: "claudeUsage.multiplierRange" });
    expect(await prisma.appSetting.count({ where: { key: "claude_usage.settings" } })).toBe(0);
  });
});

describe("get_claude_usage through the connector", () => {
  it("gives a super admin the report with a link to the screen", async () => {
    const { ariel } = await seed();
    const result = await call(ariel, "get_claude_usage", { days: 30 });
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.url).toMatch(/\/app\/claude-usage\?days=30$/);
    expect(body.period.days).toBe(30);
    expect(Array.isArray(body.people)).toBe(true);
  });

  it("refuses an employee and an Ankora admin in the domain's own words", async () => {
    const { hadas } = await seed();
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    for (const who of [hadas, admin]) {
      const result = await call(who, "get_claude_usage", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("רק מנהל-על");
      expect(result.content[0].text).not.toContain("unexpected server error");
    }
  });

  it("refuses the screen's settings to anyone but a super admin", async () => {
    const { hadas } = await seed();
    await expect(updateClaudeUsageSettings(hadas, { multiplier: 2 })).rejects.toMatchObject({ code: "claudeUsage.forbidden" });
  });
});
