import { describe, expect, it } from "vitest";
import { localDateKey } from "@/lib/timezone";
// Needs overview-trend.ts, which transitively imports lib/prisma.ts - this
// sandbox has no network route to Prisma's engine CDN, so this file (like
// every other test that touches a Prisma-importing domain module -
// billing.test.ts, hour-banks.test.ts, reports.test.ts, etc.) fails at
// import time here with "@prisma/client did not initialize yet." Verified
// by direct calculation instead and will run for real in any environment
// with network access to generate the Prisma client.
import { computeTrendWindows } from "@/lib/app-domain/overview-trend";

describe("computeTrendWindows() - Overview hours-trend chart date math", () => {
  it("builds 7 day windows ending today, chronologically ordered, with today labeled", () => {
    // 2026-03-04T10:00:00Z is 2026-03-04, Wednesday, Israel local (winter+DST n/a in March, +2).
    const now = new Date("2026-03-04T10:00:00Z");
    const { dayWindows } = computeTrendWindows(now);

    expect(dayWindows).toHaveLength(7);
    expect(localDateKey(dayWindows[0].from)).toBe("2026-02-26");
    expect(localDateKey(dayWindows[6].from)).toBe("2026-03-04");
    // Each window is exactly one calendar day, contiguous with the next.
    for (let i = 0; i < 7; i++) {
      expect(localDateKey(dayWindows[i].to)).toBe(localDateKey(new Date(dayWindows[i].from.getTime() + 24 * 3600_000)));
      if (i > 0) expect(dayWindows[i].from.getTime()).toBe(dayWindows[i - 1].to.getTime());
    }
    expect(dayWindows[6].label).toContain("(היום)");
    expect(dayWindows[0].label).not.toContain("(היום)");
    expect(dayWindows[6].label).toContain("רביעי"); // Wednesday
  });

  it("builds 7 COMPLETE Sun-Sat week windows, excluding the current in-progress week", () => {
    // 2026-03-04 is a Wednesday - "this week" (Sun 2026-03-01 - Sat
    // 2026-03-07) is still in progress and must NOT appear as a bucket.
    const now = new Date("2026-03-04T10:00:00Z");
    const { weekWindows } = computeTrendWindows(now);

    expect(weekWindows).toHaveLength(7);
    // Most recent bucket = last week = Sun 2026-02-22 - Sun 2026-03-01 (exclusive end).
    expect(localDateKey(weekWindows[6].from)).toBe("2026-02-22");
    expect(localDateKey(weekWindows[6].to)).toBe("2026-03-01");
    expect(weekWindows[6].label).toBe("שבוע שעבר");
    // Oldest bucket = 7 complete weeks back.
    expect(localDateKey(weekWindows[0].from)).toBe("2026-01-11");
    expect(localDateKey(weekWindows[0].to)).toBe("2026-01-18");
    expect(weekWindows[0].label).toBe("לפני 7 שבועות");
    // Every window is exactly 7 days and contiguous with the next.
    for (let i = 0; i < 7; i++) {
      expect(weekWindows[i].to.getTime() - weekWindows[i].from.getTime()).toBe(7 * 24 * 3600_000);
      if (i > 0) expect(weekWindows[i].from.getTime()).toBe(weekWindows[i - 1].to.getTime());
    }
    // No week window extends into "this week" (Sun 2026-03-01 onward).
    const startOfThisWeek = new Date(weekWindows[6].to);
    for (const w of weekWindows) {
      expect(w.to.getTime()).toBeLessThanOrEqual(startOfThisWeek.getTime());
    }
  });

  it("computes correct week windows when `now` falls exactly on a Sunday (Israel local)", () => {
    // 2026-03-01T05:00:00Z is 2026-03-01 07:00 Israel - a Sunday, so "this
    // week" just started and the most recent complete week is the 7 days
    // immediately before it.
    const now = new Date("2026-03-01T05:00:00Z");
    const { weekWindows } = computeTrendWindows(now);
    expect(localDateKey(weekWindows[6].to)).toBe("2026-03-01");
    expect(localDateKey(weekWindows[6].from)).toBe("2026-02-22");
  });

  it("handles a UTC/local calendar-day disagreement correctly (late-night UTC, next day in Israel)", () => {
    // 2026-03-03T22:30:00Z is 2026-03-04 00:30 in Israel (already Wednesday
    // locally, UTC still Tuesday) - day windows must use the Israel date.
    const now = new Date("2026-03-03T22:30:00Z");
    const { dayWindows } = computeTrendWindows(now);
    expect(localDateKey(dayWindows[6].from)).toBe("2026-03-04");
  });
});
