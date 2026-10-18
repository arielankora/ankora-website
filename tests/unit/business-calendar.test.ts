import { describe, it, expect } from "vitest";
import {
  calendarForCountry,
  calendarSourceLine,
  processCalendar,
  addDaysToKey,
  isBusinessDay,
  rollToBusinessDay,
  subtractBusinessDays,
  weekdayOfKey,
} from "@/lib/business-calendar";

// Org-brain spec 3.10 and decision 6 (13.10.2026). Every expected date
// below was checked against a printed calendar, not derived from the code.

describe("weekdayOfKey / addDaysToKey", () => {
  it("reads the weekday of a calendar day", () => {
    expect(weekdayOfKey("2026-11-10")).toBe(2); // Tuesday
    expect(weekdayOfKey("2026-11-08")).toBe(0); // Sunday
  });
  it("crosses month and year boundaries", () => {
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("isBusinessDay - Israel", () => {
  it("Friday and Saturday are not business days, Sunday is", () => {
    expect(isBusinessDay("2026-11-06", "IL")).toBe(false); // Friday
    expect(isBusinessDay("2026-11-07", "IL")).toBe(false); // Saturday
    expect(isBusinessDay("2026-11-08", "IL")).toBe(true); // Sunday
  });
  it("yom tov and Yom HaAtzma'ut are rest days", () => {
    expect(isBusinessDay("2026-09-21", "IL")).toBe(false); // Yom Kippur 5787 (Monday)
    expect(isBusinessDay("2026-09-12", "IL")).toBe(false); // Rosh Hashana I (Saturday anyway)
    expect(isBusinessDay("2026-09-13", "IL")).toBe(false); // Rosh Hashana II (Sunday)
    expect(isBusinessDay("2026-04-22", "IL")).toBe(false); // Yom HaAtzma'ut 5786 (Wednesday)
    expect(isBusinessDay("2026-05-22", "IL")).toBe(false); // Shavuot (Friday anyway)
  });
  it("chol hamoed and erev chag stay business days", () => {
    expect(isBusinessDay("2026-09-28", "IL")).toBe(true); // Chol HaMoed Sukkot (Monday)
    expect(isBusinessDay("2026-09-20", "IL")).toBe(true); // Erev Yom Kippur (Sunday)
  });
});

describe("isBusinessDay - United States", () => {
  it("Saturday and Sunday are not business days, Friday is", () => {
    expect(isBusinessDay("2026-11-06", "US")).toBe(true); // Friday
    expect(isBusinessDay("2026-11-07", "US")).toBe(false);
    expect(isBusinessDay("2026-11-08", "US")).toBe(false);
  });
  it("federal holidays by rule", () => {
    expect(isBusinessDay("2026-11-26", "US")).toBe(false); // Thanksgiving, 4th Thursday
    expect(isBusinessDay("2026-09-07", "US")).toBe(false); // Labor Day, 1st Monday
    expect(isBusinessDay("2026-05-25", "US")).toBe(false); // Memorial Day, last Monday
    expect(isBusinessDay("2026-01-19", "US")).toBe(false); // MLK Day, 3rd Monday
    expect(isBusinessDay("2026-10-12", "US")).toBe(false); // Columbus Day, 2nd Monday
  });
  it("a fixed holiday on a weekend is observed on the nearest weekday", () => {
    expect(isBusinessDay("2026-07-03", "US")).toBe(false); // July 4 2026 is a Saturday
    expect(isBusinessDay("2027-12-24", "US")).toBe(false); // Christmas 2027 is a Saturday
    expect(isBusinessDay("2027-06-18", "US")).toBe(false); // Juneteenth 2027 is a Saturday
    expect(isBusinessDay("2028-01-17", "US")).toBe(false); // MLK 2028
  });
  it("New Year's Day on a Saturday is observed on Dec 31 of the year before", () => {
    // Jan 1 2028 is a Saturday.
    expect(isBusinessDay("2027-12-31", "US")).toBe(false);
  });
  it("Israeli holidays are business days in the US calendar", () => {
    expect(isBusinessDay("2026-09-21", "US")).toBe(true); // Yom Kippur, Monday
  });
});

describe("rollToBusinessDay", () => {
  it("leaves a business day alone", () => {
    expect(rollToBusinessDay("2026-11-10", "IL", "PREVIOUS_BUSINESS_DAY")).toBe("2026-11-10");
  });
  it("Saturday the 10th moves to Thursday the 8th in Israel", () => {
    // Oct 10 2026 is a Saturday.
    expect(rollToBusinessDay("2026-10-10", "IL", "PREVIOUS_BUSINESS_DAY")).toBe("2026-10-08");
    expect(rollToBusinessDay("2026-10-10", "IL", "NEXT_BUSINESS_DAY")).toBe("2026-10-11");
  });
  it("skips a weekend that runs into a holiday", () => {
    // Rosh Hashana 5787: Sat 12 and Sun 13 Sep 2026, after Friday 11.
    expect(rollToBusinessDay("2026-09-12", "IL", "NEXT_BUSINESS_DAY")).toBe("2026-09-14");
    expect(rollToBusinessDay("2026-09-13", "IL", "PREVIOUS_BUSINESS_DAY")).toBe("2026-09-10");
  });
  it("NONE never moves", () => {
    expect(rollToBusinessDay("2026-10-10", "IL", "NONE")).toBe("2026-10-10");
  });
});

describe("subtractBusinessDays", () => {
  it("three Israeli business days before Tuesday 10.11.2026 is Thursday 5.11", () => {
    expect(subtractBusinessDays("2026-11-10", 3, "IL")).toBe("2026-11-05");
  });
  it("two Israeli business days before is Sunday 8.11", () => {
    expect(subtractBusinessDays("2026-11-10", 2, "IL")).toBe("2026-11-08");
  });
  it("the same count is different in the US calendar", () => {
    // Mon 9, Fri 6, Thu 5.
    expect(subtractBusinessDays("2026-11-10", 3, "US")).toBe("2026-11-05");
    // Thanksgiving week: 3 US business days before Mon 30.11 skips Thu 26.
    expect(subtractBusinessDays("2026-11-30", 3, "US")).toBe("2026-11-24");
  });
  it("skips Israeli holidays", () => {
    // Before Tue 22.9.2026: Mon 21 is Yom Kippur, Sun 20, Thu 17, Wed 16.
    expect(subtractBusinessDays("2026-09-22", 2, "IL")).toBe("2026-09-17");
  });
  it("zero returns the day itself", () => {
    expect(subtractBusinessDays("2026-11-07", 0, "IL")).toBe("2026-11-07");
  });
});

describe("the calendar a process decides (decision 6)", () => {
  it("is set on the process, or its entity's country, or none", () => {
    expect(calendarForCountry(" us ")).toBe("US");
    expect(calendarForCountry("GB")).toBeNull();
    expect(processCalendar({ businessCalendar: "IL", entity: { name: "NUX Inc", country: "US" } })).toEqual({ key: "IL", by: "PROCESS", entityName: null });
    expect(processCalendar({ businessCalendar: null, entity: { name: "NUX Inc", country: "US" } })).toEqual({ key: "US", by: "ENTITY", entityName: "NUX Inc" });
    expect(processCalendar({ businessCalendar: null, entity: { name: "NUX UK", country: "GB" } })).toBeNull();
    expect(processCalendar({ businessCalendar: null, entity: null })).toBeNull();
  });

  it("says why, in the date's words", () => {
    expect(calendarSourceLine("P3", "Washington DOR", { key: "US", by: "ENTITY", entityName: "NUX Inc" })).toBe('ארה"ב (שני עד שישי), לפי הישות NUX Inc של התהליך P3 Washington DOR');
    expect(calendarSourceLine("P3", "Washington DOR", { key: "IL", by: "PROCESS", entityName: null })).toContain("כפי שנקבע בתהליך P3");
  });
});
