import { describe, expect, it } from "vitest";
import {
  addMonths,
  calendarHref,
  isDayKey,
  parseShow,
  parseView,
  shiftAnchor,
  visibleDays,
} from "@/lib/calendar-keys";
import { occurrencesInRange, type OccurrenceRow } from "@/lib/app-domain/calendar-occurrences";
import { computeHolidayOccurrencesForYear } from "@/lib/app-domain/important-dates-holidays";
import { localDateKey } from "@/lib/timezone";
import { backLabel, carriedListQuery, tasksListHref } from "@/app/(product)/app/(authenticated)/tasks/list-query";
import { calendarBackHref, calendarFrom, parseDrawer } from "@/lib/calendar-keys";

// 19.10.2026, the calendar screen. No Prisma here: calendar-keys.ts is
// plain key arithmetic and calendar-occurrences.ts only walks the
// recurrence engine.

describe("visibleDays", () => {
  it("a day view is that one day", () => {
    expect(visibleDays("day", "2026-10-19")).toEqual(["2026-10-19"]);
  });

  it("a week runs Sunday to Saturday around the anchor", () => {
    const days = visibleDays("week", "2026-10-21"); // Wednesday
    expect(days[0]).toBe("2026-10-18");
    expect(days[6]).toBe("2026-10-24");
    expect(days).toHaveLength(7);
  });

  it("a week anchored on Sunday starts on it", () => {
    expect(visibleDays("week", "2026-10-18")[0]).toBe("2026-10-18");
  });

  it("a month is whole weeks covering the 1st to the last day", () => {
    const days = visibleDays("month", "2026-10-19");
    // 1.10.2026 is a Thursday, 31.10.2026 a Saturday.
    expect(days[0]).toBe("2026-09-27");
    expect(days[days.length - 1]).toBe("2026-10-31");
    expect(days.length % 7).toBe(0);
    expect(days).toContain("2026-10-01");
  });

  it("crosses the October DST change without skipping or repeating a day", () => {
    // Israel leaves summer time on 25.10.2026.
    const days = visibleDays("week", "2026-10-25");
    expect(new Set(days).size).toBe(7);
    expect(days).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  });
});

describe("shiftAnchor and addMonths", () => {
  it("moves by a day, a week or a month", () => {
    expect(shiftAnchor("day", "2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftAnchor("week", "2026-10-19", -1)).toBe("2026-10-12");
    expect(shiftAnchor("month", "2026-10-19", 1)).toBe("2026-11-19");
  });

  it("clamps to the end of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
});

describe("URL state", () => {
  it("falls back to week and everything on anything unknown", () => {
    expect(parseView("year")).toBe("week");
    expect(parseView(undefined)).toBe("week");
    expect(parseShow("x")).toBe("all");
    expect(parseShow("dates")).toBe("dates");
  });

  it("validates day keys, including impossible dates", () => {
    expect(isDayKey("2026-10-19")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("19.10.2026")).toBe(false);
  });

  it("leaves defaults out of the address", () => {
    const today = "2026-10-19";
    expect(calendarHref({ view: "week", date: today, show: "all", mine: true }, today)).toBe("/app/calendar");
    expect(calendarHref({ view: "month", date: "2026-11-01", show: "tasks", clientId: "c1", mine: false }, today)).toBe(
      "/app/calendar?view=month&date=2026-11-01&show=tasks&clientId=c1&mine=0"
    );
  });
});

const base: OccurrenceRow = {
  calendarType: "GREGORIAN",
  month: 10,
  day: 20,
  recurrence: "ANNUAL",
  onceDate: null,
  customIntervalDays: null,
  originYear: null,
  leapDayUseMarchFirst: false,
  hebrewAdarTwoInLeapYear: true,
  timezone: "Asia/Jerusalem",
  weekday: null,
  intervalMonths: null,
  rollConvention: "NONE",
  businessCalendar: "IL",
  precision: "EXACT",
  rangeStart: null,
  rangeEnd: null,
  source: "MANUAL",
  holidayKey: null,
};

describe("occurrencesInRange", () => {
  it("an annual date occurs once in its month", () => {
    expect(occurrencesInRange(base, "2026-09-27", "2026-10-31")).toEqual(["2026-10-20"]);
  });

  it("an annual date outside the range does not occur", () => {
    expect(occurrencesInRange(base, "2026-11-01", "2026-11-30")).toEqual([]);
  });

  it("a monthly date occurs in both months a grid touches", () => {
    const monthly = { ...base, recurrence: "MONTHLY" as const, day: 28, intervalMonths: 1 };
    expect(occurrencesInRange(monthly, "2026-09-27", "2026-10-31")).toEqual(["2026-09-28", "2026-10-28"]);
  });

  it("a weekly date occurs every week", () => {
    const weekly = { ...base, recurrence: "WEEKLY" as const, weekday: 1 };
    expect(occurrencesInRange(weekly, "2026-10-18", "2026-10-31")).toEqual(["2026-10-19", "2026-10-26"]);
  });

  it("a date with an unknown day has no occurrences", () => {
    expect(occurrencesInRange({ ...base, precision: "UNKNOWN" }, "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("a once date in the past does not occur", () => {
    const once = { ...base, recurrence: "ONCE" as const, onceDate: new Date("2026-10-05T00:00:00Z") };
    expect(occurrencesInRange(once, "2026-10-18", "2026-10-24")).toEqual([]);
    expect(occurrencesInRange(once, "2026-10-01", "2026-10-10")).toEqual(["2026-10-05"]);
  });

  it("a holiday is recomputed per year, not projected from this year's day", () => {
    const year = 2027;
    const occ = computeHolidayOccurrencesForYear("il_holidays", year)[0];
    const key = localDateKey(occ.date);
    // The stored row carries some other year's day; it must not matter.
    const row = { ...base, source: "HOLIDAY" as const, holidayKey: occ.key, month: 1, day: 1 };
    expect(occurrencesInRange(row, `${year}-01-01`, `${year}-12-31`)).toContain(key);
  });

  it("an unknown holiday key yields nothing rather than throwing", () => {
    expect(occurrencesInRange({ ...base, source: "HOLIDAY" as const, holidayKey: "no-such-holiday" }, "2026-01-01", "2026-12-31")).toEqual([]);
  });
});

describe("the way back to the calendar", () => {
  const from = calendarFrom("view=month&date=2026-11-01&show=tasks&mine=0");

  it("a task opened from the calendar goes back to the same calendar", () => {
    expect(tasksListHref(from)).toBe("/app/calendar?view=month&date=2026-11-01&show=tasks&mine=0");
    expect(backLabel(from)).toBe("חזרה ליומן");
  });

  it("a step opened from that task still leads back to the calendar", () => {
    expect(tasksListHref(carriedListQuery(from))).toBe("/app/calendar?view=month&date=2026-11-01&show=tasks&mine=0");
  });

  it("the drawer travels with the way back", () => {
    expect(tasksListHref(calendarFrom("view=week&drawer=overdue"))).toBe("/app/calendar?view=week&drawer=overdue");
    expect(calendarHref({ view: "week", date: "2026-10-19", show: "all", mine: true, drawer: "undated" }, "2026-10-19")).toBe("/app/calendar?drawer=undated");
    expect(parseDrawer("undated")).toBe("undated");
    expect(parseDrawer("x")).toBeUndefined();
  });

  it("only the calendar's own keys survive, and the path is always the calendar", () => {
    expect(calendarBackHref("calendar:view=day&next=https://evil.example&q=x")).toBe("/app/calendar?view=day");
    expect(calendarBackHref("calendar:")).toBe("/app/calendar");
  });

  it("a list `from` is untouched", () => {
    expect(tasksListHref("status=DONE")).toBe("/app/tasks?status=DONE");
    expect(backLabel("status=DONE")).toBe("חזרה למשימות");
    expect(calendarBackHref("status=DONE")).toBeNull();
  });
});
