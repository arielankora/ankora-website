import { describe, it, expect } from "vitest";
import { parsePeriodOffset, MAX_MONTH_OFFSET, MAX_WEEK_OFFSET } from "@/lib/period-offset";

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
