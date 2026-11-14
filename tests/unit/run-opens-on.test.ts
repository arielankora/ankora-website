import { describe, expect, it } from "vitest";
import { runOpensOn } from "@/lib/app-domain/important-dates-recurrence";
import { localDateKey, TIMEZONE } from "@/lib/timezone";

// The day a run opens (14.11.2026): one rule for the daily job, the list
// of processes and the process's page. NUX P2 showed 21.11 in the list
// and 19.11 on its page for the payment of 25.11: the page counted the
// date's four calendar days as business days.

const day = (d: Date) => localDateKey(d, TIMEZONE);
const wed25 = new Date("2026-11-24T22:00:00Z"); // 25.11.2026, midnight in Israel

describe("runOpensOn", () => {
  it("counts the date's lead in its own unit", () => {
    expect(day(runOpensOn(wed25, { autoTaskLeadDays: 4, leadUnit: "CALENDAR_DAYS", businessCalendar: "IL" }, 0))).toBe("2026-11-21");
    expect(day(runOpensOn(wed25, { autoTaskLeadDays: 4, leadUnit: "BUSINESS_DAYS", businessCalendar: "IL" }, 0))).toBe("2026-11-19");
  });

  it("opens earlier when the earliest step needs it, never later", () => {
    expect(day(runOpensOn(wed25, { autoTaskLeadDays: 1, leadUnit: "CALENDAR_DAYS", businessCalendar: "IL" }, 3))).toBe("2026-11-22");
    expect(day(runOpensOn(wed25, { autoTaskLeadDays: 10, leadUnit: "CALENDAR_DAYS", businessCalendar: "IL" }, 3))).toBe("2026-11-15");
  });
});
