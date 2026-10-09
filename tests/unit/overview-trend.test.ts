import { describe, expect, it } from "vitest";
import { localDateKey } from "@/lib/timezone";
// Needs overview-trend.ts, which transitively imports lib/prisma.ts - this
// sandbox has no network route to Prisma's engine CDN, so this file (like
// every other test that touches a Prisma-importing domain module -
// billing.test.ts, hour-banks.test.ts, reports.test.ts, etc.) fails at
// import time here with "@prisma/client did not initialize yet." Verified
// by direct calculation instead and will run for real in any environment
// with network access to generate the Prisma client.
import { buildSeries, computeTrendWindows, topLegend, type EntryRow } from "@/lib/app-domain/overview-trend";

describe("computeTrendWindows() - Overview hours-trend chart date math", () => {
  it("builds 14 day windows ending today, chronologically ordered, with today labeled", () => {
    // App redesign (design_handoff_ankora_app_redesign/README.md, screen 1):
    // widened from 7 to 14 days. 2026-03-04T10:00:00Z is 2026-03-04,
    // Wednesday, Israel local (winter+DST n/a in March, +2).
    const now = new Date("2026-03-04T10:00:00Z");
    const { dayWindows } = computeTrendWindows(now);

    expect(dayWindows).toHaveLength(14);
    expect(localDateKey(dayWindows[0].from)).toBe("2026-02-19");
    expect(localDateKey(dayWindows[13].from)).toBe("2026-03-04");
    // Each window is exactly one calendar day, contiguous with the next.
    for (let i = 0; i < 14; i++) {
      expect(localDateKey(dayWindows[i].to)).toBe(localDateKey(new Date(dayWindows[i].from.getTime() + 24 * 3600_000)));
      if (i > 0) expect(dayWindows[i].from.getTime()).toBe(dayWindows[i - 1].to.getTime());
    }
    expect(dayWindows[13].label).toContain("(היום)");
    expect(dayWindows[0].label).not.toContain("(היום)");
    expect(dayWindows[13].label).toContain("רביעי"); // Wednesday
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
    expect(localDateKey(dayWindows[13].from)).toBe("2026-03-04");
  });
});

describe("computeTrendWindows() - date ranges under each bar", () => {
  it("gives each week its Sunday-to-Saturday dates", () => {
    // Friday 9.10.2026, Israel. Last week is Sun 27.9 to Sat 3.10.
    const { weekWindows } = computeTrendWindows(new Date("2026-10-09T09:00:00Z"));
    expect(weekWindows[6].label).toBe("שבוע שעבר");
    expect(weekWindows[6].range).toBe("27.9 - 3.10");
    expect(weekWindows[0].range).toBe("16.8 - 22.8");
  });

  it("gives each day its date", () => {
    const { dayWindows } = computeTrendWindows(new Date("2026-10-09T09:00:00Z"));
    expect(dayWindows[13].range).toBe("9.10");
    expect(dayWindows[0].range).toBe("26.9");
  });
});

describe("topLegend() / buildSeries() - every hour is on the chart", () => {
  const window = {
    from: new Date("2026-09-27T00:00:00Z"),
    to: new Date("2026-10-04T00:00:00Z"),
    label: "שבוע שעבר",
    range: "27.9 - 3.10",
  };
  // Seven categories, the largest first: 7h, 6h, ... 1h.
  const entries: EntryRow[] = Array.from({ length: 7 }, (_, i) => ({
    startAt: new Date("2026-09-28T08:00:00Z"),
    actualSeconds: (7 - i) * 3600,
    userId: "u1",
    clientId: "c1",
    categoryId: `cat${i}`,
    userName: "Hadas",
    clientName: "Grantor",
    categoryName: `קטגוריה ${i}`,
  }));

  it("keeps the top five and folds the rest into a sixth 'אחר' slot", () => {
    const legend = topLegend(entries, "category");
    expect(legend).toHaveLength(6);
    expect(legend[5].name).toBe("אחר");
  });

  it("does not add 'אחר' when there are five or fewer series", () => {
    expect(topLegend(entries.slice(0, 5), "category")).toHaveLength(5);
  });

  it("adds up to the same total as the entries themselves", () => {
    // Regression: the remainder (2h + 1h here) was summed but never
    // emitted, so the category view showed 76.7 of 130.1 hours.
    const series = buildSeries(entries, "category", [window], topLegend(entries, "category"));
    const total = series.buckets[0].segments.reduce((sum, s) => sum + s.hours, 0);
    expect(total).toBe(28);
    expect(series.buckets[0].segments.find((s) => s.name === "אחר")?.hours).toBe(3);
  });
});

describe("buildSeries() - the total does not depend on how the bar is split", () => {
  it("gives the same total by employee, by client and by category", () => {
    const window = {
      from: new Date("2026-09-27T00:00:00Z"),
      to: new Date("2026-10-04T00:00:00Z"),
      label: "שבוע שעבר",
      range: "27.9 - 3.10",
    };
    // Five entries of 1h 3m each (1.05h). Rounded per segment to 0.1 and
    // then summed: one segment gives 5.3, five segments give 5 x 1.1 = 5.5.
    const entries: EntryRow[] = Array.from({ length: 5 }, (_, i) => ({
      startAt: new Date("2026-09-28T08:00:00Z"),
      actualSeconds: 63 * 60,
      userId: "u1",
      clientId: `c${i}`,
      categoryId: `cat${i}`,
      userName: "Hadas",
      clientName: `לקוח ${i}`,
      categoryName: `קטגוריה ${i}`,
    }));
    const totalFor = (dimension: "employee" | "client" | "category") =>
      buildSeries(entries, dimension, [window], topLegend(entries, dimension))
        .buckets[0].segments.reduce((sum, s) => sum + s.hours, 0);

    expect(totalFor("employee")).toBeCloseTo(5.25, 9);
    expect(totalFor("client")).toBeCloseTo(5.25, 9);
    expect(totalFor("category")).toBeCloseTo(5.25, 9);
  });
});
