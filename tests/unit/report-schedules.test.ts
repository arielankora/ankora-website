import { describe, expect, it } from "vitest";
import { isScheduleDue, computeReportingPeriod, monthlyDetailedToCsv } from "@/lib/app-domain/report-schedules";

// Phase 6 - spec 15's cadence-check and reporting-period pure functions.
// Same documented limitation as tests/unit/reports.test.ts /
// hour-banks.test.ts: this file imports lib/app-domain/report-schedules.ts,
// which itself imports "server-only" + lib/prisma, so it cannot actually
// run inside this sandbox (@prisma/client cannot reach binaries.prisma.sh
// here) - runs normally on Vercel's Preview build, which has network
// access. monthlyDetailedToCsv() additionally reuses lib/csv.ts (already
// independently unit-tested in tests/unit/csv.test.ts).

describe("isScheduleDue() - spec 15 cadence, ADR addendum 13.5", () => {
  const now = new Date(Date.UTC(2026, 8, 7, 6, 0, 0)); // 2026-09-07 06:00 UTC, a Monday
  const todayWeekday = now.getUTCDay();
  const todayDayOfMonth = now.getUTCDate();

  it("is due for a WEEKLY schedule whose dayOfWeek matches today (UTC timezone)", () => {
    expect(
      isScheduleDue(
        { frequency: "WEEKLY", timezone: "UTC", dayOfWeek: todayWeekday, dayOfMonth: null, lastSentAt: null, enabled: true },
        now
      )
    ).toBe(true);
  });

  it("is not due for a WEEKLY schedule on a different weekday", () => {
    const otherWeekday = (todayWeekday + 1) % 7;
    expect(
      isScheduleDue(
        { frequency: "WEEKLY", timezone: "UTC", dayOfWeek: otherWeekday, dayOfMonth: null, lastSentAt: null, enabled: true },
        now
      )
    ).toBe(false);
  });

  it("is due for a MONTHLY schedule whose dayOfMonth matches today (UTC timezone)", () => {
    expect(
      isScheduleDue(
        { frequency: "MONTHLY", timezone: "UTC", dayOfWeek: null, dayOfMonth: todayDayOfMonth, lastSentAt: null, enabled: true },
        now
      )
    ).toBe(true);
  });

  it("is never due when the schedule is disabled, even on the matching day", () => {
    expect(
      isScheduleDue(
        { frequency: "WEEKLY", timezone: "UTC", dayOfWeek: todayWeekday, dayOfMonth: null, lastSentAt: null, enabled: false },
        now
      )
    ).toBe(false);
  });

  it("guards against re-sending within the same day (lastSentAt under 20h ago)", () => {
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000);
    expect(
      isScheduleDue(
        { frequency: "WEEKLY", timezone: "UTC", dayOfWeek: todayWeekday, dayOfMonth: null, lastSentAt: twoHoursAgo, enabled: true },
        now
      )
    ).toBe(false);
  });

  it("is due again once lastSentAt is more than 20 hours in the past, on the matching day", () => {
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 3600_000);
    expect(
      isScheduleDue(
        {
          frequency: "WEEKLY",
          timezone: "UTC",
          dayOfWeek: todayWeekday,
          dayOfMonth: null,
          lastSentAt: twentyFiveHoursAgo,
          enabled: true,
        },
        now
      )
    ).toBe(true);
  });

  it("defaults an unset dayOfWeek/dayOfMonth to 0/1 rather than throwing", () => {
    expect(() =>
      isScheduleDue(
        { frequency: "WEEKLY", timezone: "UTC", dayOfWeek: null, dayOfMonth: null, lastSentAt: null, enabled: true },
        now
      )
    ).not.toThrow();
  });
});

describe("computeReportingPeriod() - spec 15's \"עבור השבוע/החודש הקודם\"", () => {
  it("returns the prior full Sun-Sat week for WEEKLY (spec: 'עבור השבוע הקודם')", () => {
    // 2026-09-09 is a Wednesday; this week starts Sunday 2026-09-06.
    const now = new Date(Date.UTC(2026, 8, 9, 6, 0, 0));
    const { from, to } = computeReportingPeriod("WEEKLY", now);
    expect(to.toISOString()).toBe(new Date(Date.UTC(2026, 8, 6)).toISOString());
    expect(from.toISOString()).toBe(new Date(Date.UTC(2026, 7, 30)).toISOString());
  });

  it("returns the prior full calendar month for MONTHLY (spec: 'עבור החודש הקודם')", () => {
    const now = new Date(Date.UTC(2026, 8, 15, 6, 0, 0)); // any day in September 2026
    const { from, to } = computeReportingPeriod("MONTHLY", now);
    expect(to.toISOString()).toBe(new Date(Date.UTC(2026, 8, 1)).toISOString());
    expect(from.toISOString()).toBe(new Date(Date.UTC(2026, 7, 1)).toISOString());
  });

  it("crosses a year boundary correctly for MONTHLY (January -> prior December)", () => {
    const now = new Date(Date.UTC(2027, 0, 10));
    const { from, to } = computeReportingPeriod("MONTHLY", now);
    expect(to.toISOString()).toBe(new Date(Date.UTC(2027, 0, 1)).toISOString());
    expect(from.toISOString()).toBe(new Date(Date.UTC(2026, 11, 1)).toISOString());
  });
});

describe("monthlyDetailedToCsv() - reuses lib/csv.ts's BOM + escaping (spec 14.4)", () => {
  it("omits the employee column entirely when no row includes one (portalShowEmployeeNames=false)", () => {
    const csv = monthlyDetailedToCsv([{ date: "2026-09-01", activity: "ייעוץ", category: "ייעוץ", billableMinutes: 30 }]);
    const withoutBom = csv.slice(1);
    expect(withoutBom.split("\r\n")[0]).toBe("תאריך,פעילות,קטגוריה,דקות לחיוב");
  });

  it("includes the employee column when at least one row has one (portalShowEmployeeNames=true)", () => {
    const csv = monthlyDetailedToCsv([
      { date: "2026-09-01", activity: "ייעוץ", category: "ייעוץ", billableMinutes: 30, employee: "נועה" },
    ]);
    const withoutBom = csv.slice(1);
    const [header, row] = withoutBom.split("\r\n");
    expect(header).toBe("תאריך,פעילות,קטגוריה,דקות לחיוב,עובד");
    expect(row).toBe("2026-09-01,ייעוץ,ייעוץ,30,נועה");
  });
});
