import { describe, expect, it } from "vitest";
import { computeNextOccurrence } from "@/lib/app-domain/important-dates-recurrence";
import { localDateKey } from "@/lib/timezone";

// QA level 3, 8.11.2026. nextCustomIntervalGregorian fast-forwards in large
// jumps before it steps day by day. The estimate of how far away "today" is
// built its Date.UTC from the "YYYY-MM-DD" key without subtracting one from the
// month, so it measured to a date about a month too late and the jump
// overshot. A reminder date whose anchor is more than a few intervals back
// skipped real occurrences. The one existing test (90 days, from Sep 16) sits
// where the overshoot is smaller than the margin of "- 1" jump.
//
// The reference below does the dumb thing: walk day by day from the anchor.

const DAY = 86_400_000;
const key = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function bruteForceNext(anchorKey: string, interval: number, fromKey: string): string {
  let ms = Date.parse(`${anchorKey}T00:00:00Z`);
  while (key(ms) < fromKey) ms += interval * DAY;
  return key(ms);
}

function actualNext(anchorKey: string, interval: number, fromKey: string): string {
  const [y, m, d] = anchorKey.split("-").map(Number);
  const result = computeNextOccurrence(
    { calendarType: "GREGORIAN", month: m, day: d, recurrence: "CUSTOM_INTERVAL", customIntervalDays: interval, originYear: y },
    new Date(`${fromKey}T09:00:00Z`)
  );
  return localDateKey(result!, "Asia/Jerusalem");
}

describe("CUSTOM_INTERVAL against a day-by-day reference", () => {
  it("does not skip occurrences: 7 days from Jan 1, asked on Nov 8", () => {
    // Jan 1 + 315 days is Nov 12. Nov 5 is behind, Nov 12 is next.
    expect(actualNext("2026-01-01", 7, "2026-11-08")).toBe("2026-11-12");
  });

  it("matches the reference for a spread of anchors, intervals and days", () => {
    const wrong: string[] = [];
    for (const interval of [1, 2, 3, 7, 10, 14, 30, 45, 90]) {
      for (const anchor of ["2024-03-15", "2025-01-01", "2026-01-01", "2026-06-30"]) {
        for (const from of ["2026-07-01", "2026-09-16", "2026-11-08", "2026-12-31", "2027-03-01"]) {
          const want = bruteForceNext(anchor, interval, from);
          const got = actualNext(anchor, interval, from);
          if (got !== want) wrong.push(`every ${interval}d from ${anchor}, asked ${from}: got ${got}, want ${want}`);
        }
      }
    }
    expect(wrong, wrong.slice(0, 5).join("\n")).toEqual([]);
  });
});
