import { describe, expect, it } from "vitest";
import {
  computeNextOccurrence,
  resolveGregorianDayForYear,
  resolveHebrewMonthForYear,
  computeElapsedYears,
  formatElapsedYearsHebrew,
} from "@/lib/app-domain/important-dates-recurrence";

// Phase 10 ("מועדים חשובים"). Unlike every other lib/app-domain/*.ts test
// file in this suite, this one CAN and DOES run in this sandbox: the
// module under test has zero Prisma import (see that file's own header
// comment) - it only imports "server-only" (stubbed by
// tests/__mocks__/server-only.ts) and lib/timezone.ts (also
// Prisma-free) - so, unlike notifications.test.ts/alerts.test.ts/etc.,
// nothing here ever touches the unavailable generated Prisma client.
// These assertions were verified to actually pass, live, in this sandbox
// via `npx vitest run` before being committed - not just written on
// faith.

describe("resolveGregorianDayForYear() - Feb 29 edge case", () => {
  it("defaults Feb 29 to Feb 28 in a non-leap year", () => {
    expect(resolveGregorianDayForYear(2, 29, 2026, false)).toEqual({ month: 2, day: 28 });
  });

  it("uses March 1 in a non-leap year when leapDayUseMarchFirst is set", () => {
    expect(resolveGregorianDayForYear(2, 29, 2026, true)).toEqual({ month: 3, day: 1 });
  });

  it("keeps Feb 29 unchanged in an actual leap year", () => {
    expect(resolveGregorianDayForYear(2, 29, 2028, false)).toEqual({ month: 2, day: 29 });
  });

  it("passes through an ordinary date unchanged", () => {
    expect(resolveGregorianDayForYear(6, 15, 2026, false)).toEqual({ month: 6, day: 15 });
  });

  it("clamps an out-of-range day to the target month's last day", () => {
    // Defensive case, not spec'd explicitly - a day=31 date landing on a
    // 30-day month (April).
    expect(resolveGregorianDayForYear(4, 31, 2026, false)).toEqual({ month: 4, day: 30 });
  });
});

describe("computeNextOccurrence() - Gregorian ANNUAL", () => {
  it("resolves a Feb 29 anniversary to Feb 28 in the current non-leap year", () => {
    const result = computeNextOccurrence(
      { calendarType: "GREGORIAN", month: 2, day: 29, recurrence: "ANNUAL", leapDayUseMarchFirst: false },
      new Date("2026-01-01T10:00:00Z")
    );
    expect(result).not.toBeNull();
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(result!)).toBe("2026-02-28");
  });

  it("rolls a year-end date forward into next year", () => {
    const result = computeNextOccurrence(
      { calendarType: "GREGORIAN", month: 1, day: 5, recurrence: "ANNUAL" },
      new Date("2026-12-20T10:00:00Z")
    );
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(result!)).toBe("2027-01-05");
  });

  it("is DST-safe across the Israel autumn clock change", () => {
    const result = computeNextOccurrence(
      { calendarType: "GREGORIAN", month: 10, day: 25, recurrence: "ANNUAL" },
      new Date("2026-10-20T10:00:00Z")
    );
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(result!)).toBe("2026-10-25");
  });
});

describe("computeNextOccurrence() - Gregorian MONTHLY", () => {
  it("clamps day 31 to each month's real length", () => {
    const result = computeNextOccurrence(
      { calendarType: "GREGORIAN", month: 1, day: 31, recurrence: "MONTHLY" },
      new Date("2026-02-01T00:00:00Z")
    );
    // February 2026 has 28 days.
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(result!)).toBe("2026-02-28");
  });
});

describe("computeNextOccurrence() - CUSTOM_INTERVAL", () => {
  it("finds the next multiple of the interval on or after fromDate", () => {
    const result = computeNextOccurrence(
      { calendarType: "GREGORIAN", month: 1, day: 1, recurrence: "CUSTOM_INTERVAL", customIntervalDays: 90, originYear: 2026 },
      new Date("2026-09-16T00:00:00Z")
    );
    // Jan 1 + 270 days = Sep 28, 2026 (the 3rd 90-day interval).
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(result!)).toBe("2026-09-28");
  });

  it("returns null for a non-positive interval", () => {
    const result = computeNextOccurrence(
      { calendarType: "GREGORIAN", month: 1, day: 1, recurrence: "CUSTOM_INTERVAL", customIntervalDays: 0 },
      new Date("2026-09-16T00:00:00Z")
    );
    expect(result).toBeNull();
  });
});

describe("computeNextOccurrence() - ONCE", () => {
  it("returns the date itself when it is still in the future", () => {
    const onceDate = new Date("2027-01-01T00:00:00Z");
    const result = computeNextOccurrence(
      { calendarType: "GREGORIAN", month: 1, day: 1, recurrence: "ONCE", onceDate },
      new Date("2026-09-16T00:00:00Z")
    );
    expect(result).toEqual(onceDate);
  });

  it("returns null once the date has already passed", () => {
    const result = computeNextOccurrence(
      { calendarType: "GREGORIAN", month: 1, day: 1, recurrence: "ONCE", onceDate: new Date("2020-01-01T00:00:00Z") },
      new Date("2026-09-16T00:00:00Z")
    );
    expect(result).toBeNull();
  });

  it("returns null when no onceDate was provided", () => {
    const result = computeNextOccurrence(
      { calendarType: "GREGORIAN", month: 1, day: 1, recurrence: "ONCE", onceDate: null },
      new Date("2026-09-16T00:00:00Z")
    );
    expect(result).toBeNull();
  });
});

describe("resolveHebrewMonthForYear() - Adar I/II edge case", () => {
  it("resolves a generic Adar (stored as ADAR_I=12) to Adar II in a leap target year by default", () => {
    // 5784 is a known Hebrew leap year.
    expect(resolveHebrewMonthForYear(12, 5784, true)).toBe(13);
  });

  it("keeps Adar I in a leap target year when hebrewAdarTwoInLeapYear is false", () => {
    expect(resolveHebrewMonthForYear(12, 5784, false)).toBe(12);
  });

  it("always resolves to Adar I (12) in a non-leap target year, regardless of the flag", () => {
    // 5785 is a known non-leap Hebrew year (immediately follows leap 5784).
    expect(resolveHebrewMonthForYear(12, 5785, true)).toBe(12);
    expect(resolveHebrewMonthForYear(13, 5785, false)).toBe(12);
  });

  it("passes through non-Adar months unchanged", () => {
    expect(resolveHebrewMonthForYear(7, 5786, true)).toBe(7); // Tishrei
  });
});

describe("computeNextOccurrence() - Hebrew ANNUAL", () => {
  it("computes a plausible Gregorian date for a Hebrew 15-Adar anniversary", () => {
    const result = computeNextOccurrence(
      { calendarType: "HEBREW", month: 12, day: 15, recurrence: "ANNUAL", hebrewAdarTwoInLeapYear: true },
      new Date("2026-09-16T00:00:00Z")
    );
    expect(result).not.toBeNull();
    // Adar falls in Feb/March - the next occurrence from September must
    // land in the following calendar year's Feb/March window.
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(result!);
    const [year, month] = ymd.split("-").map(Number);
    expect(year).toBe(2027);
    expect(month).toBeGreaterThanOrEqual(2);
    expect(month).toBeLessThanOrEqual(3);
  });
});

describe("computeElapsedYears()", () => {
  it("computes a simple year difference", () => {
    expect(computeElapsedYears(1976, 2026)).toBe(50);
  });

  it("returns null when no origin year is set", () => {
    expect(computeElapsedYears(null, 2026)).toBeNull();
    expect(computeElapsedYears(undefined, 2026)).toBeNull();
  });

  it("returns null for a future origin year (defensive - never a real anniversary)", () => {
    expect(computeElapsedYears(2030, 2026)).toBeNull();
  });
});

describe("formatElapsedYearsHebrew()", () => {
  it("uses the singular form for 1 year", () => {
    expect(formatElapsedYearsHebrew(1)).toBe("שנה אחת");
  });

  it("uses the Hebrew dual form for 2 years", () => {
    expect(formatElapsedYearsHebrew(2)).toBe("שנתיים");
  });

  it("uses the plural numeric form for 3+ years", () => {
    expect(formatElapsedYearsHebrew(50)).toBe("50 שנים");
  });
});
