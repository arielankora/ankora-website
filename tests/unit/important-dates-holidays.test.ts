import { describe, expect, it } from "vitest";
import { HebrewCalendar } from "@hebcal/core";
import { computeHolidayOccurrencesForYear, HOLIDAY_CATALOG, holidayDateKey } from "@/lib/app-domain/important-dates-holidays";

/// Independently recomputes, via a raw @hebcal/core query (a separate
/// code path from lib/app-domain/important-dates-holidays.ts's own
/// matching logic), the Gregorian date of the event whose exact
/// description equals `desc` in a given year - used to cross-check the
/// module under test without hardcoding a specific calendar date that
/// shifts every year and is easy to misremember/mistranscribe.
function rawHebcalDateFor(desc: string, year: number): string {
  const events = HebrewCalendar.calendar({ year, isHebrewYear: false, il: true });
  const match = events.find((e) => e.getDesc() === desc);
  if (!match) throw new Error(`No event named "${desc}" found in ${year}`);
  return holidayDateKey(match.getDate().greg());
}

// Phase 10 ("מועדים חשובים"). Like important-dates-recurrence.test.ts,
// this module has zero Prisma import, so these assertions genuinely run
// in this sandbox (verified live via `npx vitest run`), unlike most of
// this suite's lib/app-domain/*.ts tests.

const IL_CATALOG_SIZE = HOLIDAY_CATALOG.filter((h) => h.calendarKey === "il_holidays").length;

describe("computeHolidayOccurrencesForYear('il_holidays') - spec: must work correctly for 2026 and 2027", () => {
  it("matches every catalog entry for 2026", () => {
    const result = computeHolidayOccurrencesForYear("il_holidays", 2026);
    expect(result).toHaveLength(IL_CATALOG_SIZE);
    expect(new Set(result.map((r) => r.key)).size).toBe(IL_CATALOG_SIZE); // no duplicate keys
  });

  it("matches every catalog entry for 2027", () => {
    const result = computeHolidayOccurrencesForYear("il_holidays", 2027);
    expect(result).toHaveLength(IL_CATALOG_SIZE);
  });

  it("moves Rosh Hashana to a different Gregorian date between 2026 and 2027 (Hebrew calendar drift)", () => {
    const y2026 = computeHolidayOccurrencesForYear("il_holidays", 2026).find((h) => h.key === "rosh_hashana");
    const y2027 = computeHolidayOccurrencesForYear("il_holidays", 2027).find((h) => h.key === "rosh_hashana");
    expect(y2026).toBeDefined();
    expect(y2027).toBeDefined();
    expect(holidayDateKey(y2026!.date)).not.toBe(holidayDateKey(y2027!.date));
  });

  it("returns occurrences sorted chronologically", () => {
    const result = computeHolidayOccurrencesForYear("il_holidays", 2026);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date.getTime()).toBeGreaterThanOrEqual(result[i - 1].date.getTime());
    }
  });

  it("never confuses Purim with Shushan Purim (adjacent, similarly-named events)", () => {
    const result = computeHolidayOccurrencesForYear("il_holidays", 2026);
    const purim = result.find((h) => h.key === "purim");
    expect(purim).toBeDefined();
    // Cross-checked against a raw, independent @hebcal/core query for the
    // exact description "Purim" - not a hardcoded date - so this catches
    // a real exact-vs-prefix matching bug without being brittle to the
    // moving Hebrew calendar.
    expect(holidayDateKey(purim!.date)).toBe(rawHebcalDateFor("Purim", 2026));
    expect(holidayDateKey(purim!.date)).not.toBe(rawHebcalDateFor("Shushan Purim", 2026));
  });

  it("never confuses Rosh Hashana with Rosh Hashana LaBehemot (New Year for Animals, ~3 weeks earlier)", () => {
    const result = computeHolidayOccurrencesForYear("il_holidays", 2026);
    const roshHashana = result.find((h) => h.key === "rosh_hashana");
    expect(roshHashana).toBeDefined();
    // The real Rosh Hashana is in September, never August.
    expect(roshHashana!.date.getUTCMonth()).toBe(8); // 0-indexed: 8 = September
  });
});

describe("computeHolidayOccurrencesForYear('international_holidays')", () => {
  it("returns fixed Gregorian dates for both years", () => {
    const y2026 = computeHolidayOccurrencesForYear("international_holidays", 2026);
    const newYear = y2026.find((h) => h.key === "new_year");
    expect(newYear).toBeDefined();
    expect(holidayDateKey(newYear!.date)).toBe("2026-01-01");

    const christmas = y2026.find((h) => h.key === "christmas");
    expect(christmas).toBeDefined();
    expect(holidayDateKey(christmas!.date)).toBe("2026-12-25");
  });
});

describe("HOLIDAY_CATALOG", () => {
  it("has a unique key per entry (holidayKey is the dedupe join key with ImportantDate)", () => {
    const keys = HOLIDAY_CATALOG.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every entry declares at least one default reminder offset", () => {
    for (const entry of HOLIDAY_CATALOG) {
      expect(entry.defaultReminderDaysBefore.length).toBeGreaterThan(0);
    }
  });
});
