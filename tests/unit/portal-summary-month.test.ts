import { describe, expect, it } from "vitest";
import { monthRange } from "@/lib/app-domain/portal-summary";

// 1.11.2026: the monthly summary's month began at UTC midnight on the 1st,
// two or three hours after the Israeli month did, so work closed in those
// hours belonged to neither month. QA found it by running at 00:06 on
// 1.11. The range is now local midnight to local midnight.
describe("monthRange()", () => {
  it("starts the month at midnight in Israel, not in UTC", () => {
    // 00:06 on 1.11.2026 in Israel (UTC+2 after the clocks went back).
    const { periodStart, periodEnd } = monthRange(new Date("2026-10-31T22:06:00Z"));
    expect(periodStart.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-11-30T22:00:00.000Z");
  });

  it("keeps work closed in the month's first hours inside that month", () => {
    const closed = new Date("2026-10-31T22:15:00Z"); // 00:15 on 1.11 in Israel
    const { periodStart, periodEnd } = monthRange(closed);
    expect(closed >= periodStart && closed < periodEnd).toBe(true);
  });

  it("follows summer time: October starts at UTC+3", () => {
    const { periodStart, periodEnd } = monthRange(new Date("2026-10-15T09:00:00Z"));
    expect(periodStart.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-10-31T22:00:00.000Z");
  });

  it("rolls December into January of the next year", () => {
    const { periodEnd } = monthRange(new Date("2026-12-20T10:00:00Z"));
    expect(periodEnd.toISOString()).toBe("2026-12-31T22:00:00.000Z");
  });
});
