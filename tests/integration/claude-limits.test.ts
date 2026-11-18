import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";
import { parseLimitReading } from "@/lib/claude-usage/limits";
import { ingestLimitReading } from "@/lib/claude-usage/cowork-ingest";
import { getClaudeUsageReport } from "@/lib/app-domain/claude-usage";
import { pruneClaudeUsage } from "@/lib/claude-usage/record";

// Way 3 (17.11.2026): a reading from the browser extension reaches
// claude_limit_samples, matched to the person by email, and shows in the
// report the screen and get_claude_usage read.

const NOW = new Date("2026-11-17T12:00:00Z");

describe("the browser extension's limit readings", () => {
  it("are matched by the Claude email, or by the Chrome profile's when the first is personal", async () => {
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "hadas@ankora.co.il" });
    const a = parseLimitReading({ email: "HADAS@ankora.co.il", fiveHour: { pct: 10 } }, NOW);
    const b = parseLimitReading({ email: "hadas.private@gmail.com", altEmail: "hadas@ankora.co.il", fiveHour: { pct: 20 } }, NOW);
    const c = parseLimitReading({ email: "stranger@example.com", fiveHour: { pct: 30 } }, NOW);
    expect(await ingestLimitReading(a.ok ? a.reading : (null as never))).toEqual({ matched: true });
    expect(await ingestLimitReading(b.ok ? b.reading : (null as never))).toEqual({ matched: true });
    expect(await ingestLimitReading(c.ok ? c.reading : (null as never))).toEqual({ matched: false });
    const rows = await prisma.claudeLimitSample.findMany({ orderBy: { fiveHourPct: "asc" } });
    expect(rows.map((r) => r.userId)).toEqual([hadas.id, hadas.id, null]);
  });

  it("show in the report as the person's current limits, and drive the summary by pace", async () => {
    const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const DAY = 86_400_000;
    // 86% of the week with only two of seven days gone: runs out before the reset.
    await prisma.claudeLimitSample.create({
      data: { userId: hadas.id, email: "h@x.co", fiveHourPct: 35, sevenDayPct: 86, sevenDayResetsAt: new Date(NOW.getTime() + 5 * DAY), observedAt: new Date(NOW.getTime() - 10 * 60_000) },
    });
    const report = await getClaudeUsageReport(ariel, { days: 7, now: NOW });
    const h = report.people.find((p) => p.userId === hadas.id)!;
    expect(h.limits?.current).toMatchObject({ fiveHourPct: 35, sevenDayPct: 86 });
    expect(h.fiveHour.weekly).toMatchObject({ usedPct: 86, state: "over" });
    expect(report.coverage.limitReadings).toBe(1);
    expect(report.summary.verdict).toBe("attention");
    expect(report.summary.kpis[1]).toMatchObject({ key: "weeklyPace", value: h.fiveHour.weekly!.projectedPct, state: "off" });
  });

  it("do not need attention for a high share a few hours before the weekly reset (18.11.2026)", async () => {
    const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.claudeLimitSample.create({
      data: { userId: hadas.id, email: "h@x.co", fiveHourPct: 5, sevenDayPct: 86, sevenDayResetsAt: new Date(NOW.getTime() + 6 * 3_600_000), observedAt: new Date(NOW.getTime() - 10 * 60_000) },
    });
    const report = await getClaudeUsageReport(ariel, { days: 7, now: NOW });
    expect(report.people.find((p) => p.userId === hadas.id)!.fiveHour.weekly).toMatchObject({ projectedPct: 89, state: "watch" });
    expect(report.summary.verdict).not.toBe("attention");
  });

  it("leave after 90 days", async () => {
    const old = new Date(NOW.getTime() - 91 * 86_400_000);
    await prisma.claudeLimitSample.createMany({
      data: [
        { email: "a@b.co", fiveHourPct: 1, observedAt: old },
        { email: "a@b.co", fiveHourPct: 1, observedAt: NOW },
      ],
    });
    expect((await pruneClaudeUsage(NOW)).limitSamples).toBe(1);
    expect(await prisma.claudeLimitSample.count()).toBe(1);
  });
});
