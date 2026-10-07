import { describe, it, expect } from "vitest";
import { parsePeriodOffset, MAX_MONTH_OFFSET, MAX_WEEK_OFFSET, israelMonthReference, israelMonthOffset } from "@/lib/period-offset";

// The portal's period screens take their offset from the query string.
// Before this parser existed, `Number(raw || 0)` handed NaN straight to
// `setUTCMonth`, and the resulting Invalid Date only surfaced at the end
// of the request - as a RangeError out of Intl.DateTimeFormat, i.e. a 500
// on a screen a client can reach by typing a URL.
describe("parsePeriodOffset", () => {
  it("passes a normal offset through", () => {
    expect(parsePeriodOffset("-1", MAX_MONTH_OFFSET)).toBe(-1);
    expect(parsePeriodOffset("3", MAX_MONTH_OFFSET)).toBe(3);
    expect(parsePeriodOffset("0", MAX_MONTH_OFFSET)).toBe(0);
  });

  it("treats a missing parameter as no offset", () => {
    expect(parsePeriodOffset(null, MAX_MONTH_OFFSET)).toBe(0);
    expect(parsePeriodOffset(undefined, MAX_WEEK_OFFSET)).toBe(0);
    expect(parsePeriodOffset("", MAX_MONTH_OFFSET)).toBe(0);
  });

  // Each of these produced an Invalid Date before the fix.
  it.each(["abc", "x", "NaN", "1e400", "-1e400", "Infinity"])(
    "refuses %s rather than carrying it into the date arithmetic",
    (raw) => {
      expect(parsePeriodOffset(raw, MAX_MONTH_OFFSET)).toBe(0);
    }
  );

  it("refuses an offset far outside the representable range", () => {
    expect(parsePeriodOffset("99999999", MAX_MONTH_OFFSET)).toBe(0);
    expect(parsePeriodOffset("-99999999", MAX_WEEK_OFFSET)).toBe(0);
  });

  it("truncates a fractional offset instead of shifting by a fraction of a month", () => {
    expect(parsePeriodOffset("2.7", MAX_MONTH_OFFSET)).toBe(2);
    expect(parsePeriodOffset("-2.7", MAX_MONTH_OFFSET)).toBe(-2);
  });

  // The guarantee the call sites actually depend on: whatever comes back,
  // the date arithmetic that follows must produce a usable Date.
  it("never produces an Invalid Date at the call site", () => {
    for (const raw of ["abc", "1e400", "99999999", "-99999999", "", null, "-1"]) {
      const d = new Date("2026-09-27T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + parsePeriodOffset(raw, MAX_MONTH_OFFSET));
      expect(Number.isNaN(d.getTime())).toBe(false);
    }
  });
});

// 7.10.2026: "previous month" in the portal returned the current month on
// the 29th-31st (setUTCMonth overflow), and the history screen's download
// links counted UTC months from a period that starts at Israeli midnight,
// so every link pointed one month early.
describe("israelMonthReference", () => {
  it("goes back one month from the last day of a 31-day month", () => {
    const r = israelMonthReference(-1, new Date("2026-10-31T10:00:00Z"));
    expect([r.year, r.month]).toEqual([2026, 9]);
    expect(r.referenceDate.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("goes back from 31 March into February (no 31 February roll-over)", () => {
    const r = israelMonthReference(-1, new Date("2027-03-31T08:00:00Z"));
    expect([r.year, r.month]).toEqual([2027, 2]);
  });

  it("crosses the year in both directions", () => {
    expect(israelMonthReference(-1, new Date("2026-01-10T10:00:00Z"))).toMatchObject({ year: 2025, month: 12 });
    expect(israelMonthReference(1, new Date("2026-12-31T10:00:00Z"))).toMatchObject({ year: 2027, month: 1 });
    expect(israelMonthReference(-13, new Date("2026-10-07T10:00:00Z"))).toMatchObject({ year: 2025, month: 9 });
  });

  it("decides the month in Israel time, not UTC", () => {
    // 22:30Z on 31.10 is already 00:30 on 1.11 in Israel.
    expect(israelMonthReference(0, new Date("2026-10-31T22:30:00Z"))).toMatchObject({ year: 2026, month: 11 });
    // And 21:30Z on 31.10 is still 31.10 (23:30) in Israel.
    expect(israelMonthReference(0, new Date("2026-10-31T21:30:00Z"))).toMatchObject({ year: 2026, month: 10 });
  });
});

describe("israelMonthOffset", () => {
  it("links a report period that starts at Israeli midnight to its own month", () => {
    // October's period starts 1.10 00:00 Israel = 30.9 21:00Z.
    expect(israelMonthOffset(new Date("2026-09-30T21:00:00Z"), new Date("2026-11-05T10:00:00Z"))).toBe(-1);
    // November's starts 1.11 00:00 Israel = 31.10 22:00Z (winter time).
    expect(israelMonthOffset(new Date("2026-10-31T22:00:00Z"), new Date("2026-11-05T10:00:00Z"))).toBe(0);
  });

  it("round-trips with israelMonthReference", () => {
    const now = new Date("2026-10-31T10:00:00Z");
    for (const offset of [-25, -12, -2, -1, 0, 1]) {
      expect(israelMonthOffset(israelMonthReference(offset, now).referenceDate, now)).toBe(offset);
    }
  });
});
