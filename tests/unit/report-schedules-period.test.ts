import { describe, expect, it } from "vitest";
import { localDateKey } from "@/lib/timezone";
// Needs report-schedules.ts, which transitively imports lib/prisma.ts -
// this sandbox has no network route to Prisma's engine CDN, so this file
// (like every other test that touches a Prisma-importing domain module -
// billing.test.ts, hour-banks.test.ts, reports.test.ts, etc.) fails at
// import time here with "@prisma/client did not initialize yet." Verified
// by direct calculation instead (see docs/adr/0001 Phase 8 addendum
// section 15.3/15.5) and will run for real in any environment with
// network access to generate the Prisma client.
import { computeReportingPeriod } from "@/lib/app-domain/report-schedules";

describe("computeReportingPeriod() - Phase 8 fix for UTC/local calendar disagreement", () => {
  it("computes the correct previous-month period when `now` is early on the 1st (Israel local), even though UTC is still the last day of the prior month", () => {
    // 2026-02-28T23:00:00Z is 2026-03-01 01:00 in Israel (winter, +2) -
    // Israel has already crossed into March, UTC has not. The old
    // getUTCMonth()-based implementation would have computed January as
    // "last month" (UTC still thinks it's February); the fix must report
    // February as last month, matching Israel's own calendar.
    const now = new Date("2026-02-28T23:00:00Z");
    const period = computeReportingPeriod("MONTHLY", now, "Asia/Jerusalem");
    expect(localDateKey(period.from)).toBe("2026-02-01");
    expect(localDateKey(period.to)).toBe("2026-03-01");
  });

  it("computes a correct weekly period spanning a month boundary", () => {
    const now = new Date("2026-03-01T10:00:00Z"); // 2026-03-01, Sunday, Israel local
    const period = computeReportingPeriod("WEEKLY", now, "Asia/Jerusalem");
    // "This week" starts Sunday 2026-03-01; "last week" is the 7 days before it.
    expect(localDateKey(period.to)).toBe("2026-03-01");
    expect(localDateKey(period.from)).toBe("2026-02-22");
  });

  it("defaults to Asia/Jerusalem when no timeZone argument is given", () => {
    const now = new Date("2026-06-15T10:00:00Z");
    const withDefault = computeReportingPeriod("MONTHLY", now);
    const withExplicit = computeReportingPeriod("MONTHLY", now, "Asia/Jerusalem");
    expect(withDefault).toEqual(withExplicit);
  });
});
