import { describe, expect, it } from "vitest";
import { parseLimitReading, personLimits, type LimitSampleIn } from "@/lib/claude-usage/limits";

// Way 3 (17.11.2026): the browser extension's readings of each person's
// five-hour and weekly usage limits. The endpoint they come from is not
// documented, so anything that is not a sane reading is dropped here.

const NOW = new Date("2026-11-17T12:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe("parseLimitReading", () => {
  it("reads the two percentages, their reset times and the email", () => {
    const r = parseLimitReading(
      { email: " Hadas@Ankora.co.il ", fiveHour: { pct: 42.25, resetsAt: inHours(3) }, sevenDay: { pct: 71, resetsAt: inHours(100) }, observedAt: NOW.toISOString(), version: "1.0.0" },
      NOW
    );
    expect(r.ok && r.reading).toMatchObject({ email: "hadas@ankora.co.il", altEmail: null, fiveHourPct: 42.3, sevenDayPct: 71, extensionVersion: "1.0.0" });
    expect(r.ok && r.reading.fiveHourResetsAt?.toISOString()).toBe(inHours(3));
  });

  it("keeps the Chrome profile's email as a second address", () => {
    const r = parseLimitReading({ email: "hadas@gmail.com", altEmail: "hadas@ankora.co.il", fiveHour: { pct: 5 } }, NOW);
    expect(r.ok && r.reading).toMatchObject({ email: "hadas@gmail.com", altEmail: "hadas@ankora.co.il" });
  });

  it("clamps a reading just past the limit to 100, and drops nonsense", () => {
    const r = parseLimitReading({ email: "a@b.co", fiveHour: { pct: 103 }, sevenDay: { pct: -4, resetsAt: "next year" } }, NOW);
    expect(r.ok && r.reading).toMatchObject({ fiveHourPct: 100, sevenDayPct: null, sevenDayResetsAt: null });
  });

  it("drops reset times far in the future and a reading time in the future", () => {
    const r = parseLimitReading({ email: "a@b.co", fiveHour: { pct: 1, resetsAt: inHours(50) }, observedAt: inHours(5) }, NOW);
    expect(r.ok && r.reading.fiveHourResetsAt).toBeNull();
    expect(r.ok && r.reading.observedAt).toEqual(NOW);
  });

  it("refuses a body with no email or no percentage", () => {
    expect(parseLimitReading({ fiveHour: { pct: 1 } }, NOW)).toEqual({ ok: false, error: "No valid email" });
    expect(parseLimitReading({ email: "a@b.co" }, NOW)).toEqual({ ok: false, error: "No usage percentage" });
    expect(parseLimitReading([], NOW).ok).toBe(false);
  });
});

describe("personLimits", () => {
  const s = (minutesAgo: number, five: number | null, week: number | null, fiveReset?: string, weekReset?: string): LimitSampleIn => ({
    userId: "u1",
    fiveHourPct: five,
    fiveHourResetsAt: fiveReset ? new Date(fiveReset) : null,
    sevenDayPct: week,
    sevenDayResetsAt: weekReset ? new Date(weekReset) : null,
    observedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  });

  it("shows the latest reading when it is fresh, the peak and distinct windows at the limit", () => {
    const p = personLimits(
      [s(300, 100, 40, inHours(-1)), s(290, 100, 41, inHours(-1)), s(120, 100, 55, inHours(2)), s(10, 30, 60, inHours(2), inHours(90))],
      NOW
    );
    expect(p.current).toMatchObject({ fiveHourPct: 30, sevenDayPct: 60 });
    expect(p.peakFiveHourPct).toBe(100);
    // Two five-hour windows reached 100%, each counted once.
    expect(p.fiveHourLimitHits).toBe(2);
    expect(p.weeklyLimitHits).toBe(0);
  });

  it("has no current reading when the last one is over an hour old, but says when it was", () => {
    const p = personLimits([s(90, 20, 30)], NOW);
    expect(p.current).toBeNull();
    expect(p.lastReadingAt).toBe(new Date(NOW.getTime() - 90 * 60_000).toISOString());
  });
});
