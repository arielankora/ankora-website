import { describe, expect, it } from "vitest";
import { HebrewCalendar } from "@hebcal/core";
import { computeHolidayOccurrencesForYear, HOLIDAY_CATALOG, HOLIDAY_CALENDAR_LABELS, holidayDateKey } from "@/lib/app-domain/important-dates-holidays";

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

const IL_CATALOG_SIZE = HOLIDAY_CATALOG.filter((h) => h.calendarKeys.includes("il_holidays")).length;

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

describe("computeHolidayOccurrencesForYear('international_holidays') - extended catalog (Ariel follow-up request)", () => {
  it("computes Easter Sunday correctly for 2026 and 2027 (cross-checked against known official dates)", () => {
    const y2026 = computeHolidayOccurrencesForYear("international_holidays", 2026).find((h) => h.key === "easter");
    const y2027 = computeHolidayOccurrencesForYear("international_holidays", 2027).find((h) => h.key === "easter");
    expect(y2026).toBeDefined();
    expect(y2027).toBeDefined();
    // Western/Gregorian Easter: 2026-04-05, 2027-03-28 (date-easter's
    // Anonymous Gregorian algorithm output, cross-checked during
    // development against publicly known Easter dates for both years).
    expect(holidayDateKey(y2026!.date)).toBe("2026-04-05");
    expect(holidayDateKey(y2027!.date)).toBe("2027-03-28");
  });

  it("computes Lunar New Year for 2026 and 2027, distinct from Gregorian New Year", () => {
    const y2026 = computeHolidayOccurrencesForYear("international_holidays", 2026).find((h) => h.key === "lunar_new_year");
    const y2027 = computeHolidayOccurrencesForYear("international_holidays", 2027).find((h) => h.key === "lunar_new_year");
    expect(y2026).toBeDefined();
    expect(y2027).toBeDefined();
    // Cross-checked during development against known real-world Chinese
    // New Year dates (2026-02-17, 2027-02-06) - never hardcoded blindly.
    expect(holidayDateKey(y2026!.date)).toBe("2026-02-17");
    expect(holidayDateKey(y2027!.date)).toBe("2027-02-06");
  });

  it("computes Ramadan start, Eid al-Fitr, and Eid al-Adha for 2026 in the correct chronological order and spacing", () => {
    const occ2026 = computeHolidayOccurrencesForYear("international_holidays", 2026);
    const ramadan = occ2026.find((h) => h.key === "ramadan_start");
    const eidFitr = occ2026.find((h) => h.key === "eid_al_fitr");
    const eidAdha = occ2026.find((h) => h.key === "eid_al_adha");
    expect(ramadan).toBeDefined();
    expect(eidFitr).toBeDefined();
    expect(eidAdha).toBeDefined();
    // Eid al-Fitr (end of Ramadan) must be after Ramadan start, roughly
    // a lunar month (29-30 days) later - not a hardcoded date, since
    // real-world observance can shift by a day around moon-sighting.
    const daysBetween = (eidFitr!.date.getTime() - ramadan!.date.getTime()) / 86400000;
    expect(daysBetween).toBeGreaterThanOrEqual(28);
    expect(daysBetween).toBeLessThanOrEqual(31);
    // Eid al-Adha falls roughly 2 lunar months after Eid al-Fitr (the
    // Hajj month, Dhu al-Hijjah, is two Hijri months after Shawwal).
    expect(eidAdha!.date.getTime()).toBeGreaterThan(eidFitr!.date.getTime());
  });

  it("includes every fixed-Gregorian entry (Valentine's Day, Intl Women's Day, Halloween, Christmas Eve/Day, New Year) at the right date", () => {
    const occ = computeHolidayOccurrencesForYear("international_holidays", 2026);
    const byKey = new Map(occ.map((h) => [h.key, h]));
    expect(holidayDateKey(byKey.get("new_year")!.date)).toBe("2026-01-01");
    expect(holidayDateKey(byKey.get("valentines_day")!.date)).toBe("2026-02-14");
    expect(holidayDateKey(byKey.get("international_womens_day")!.date)).toBe("2026-03-08");
    expect(holidayDateKey(byKey.get("halloween")!.date)).toBe("2026-10-31");
    expect(holidayDateKey(byKey.get("christmas_eve")!.date)).toBe("2026-12-24");
    expect(holidayDateKey(byKey.get("christmas")!.date)).toBe("2026-12-25");
  });

  it("never produces duplicate keys within international_holidays for either year", () => {
    for (const year of [2026, 2027]) {
      const occ = computeHolidayOccurrencesForYear("international_holidays", year);
      expect(new Set(occ.map((h) => h.key)).size).toBe(occ.length);
    }
  });
});

describe("computeHolidayOccurrencesForYear('us_holidays') - per-country calendar (spec: at least US/UK selection)", () => {
  it("computes Mother's Day (US) as the 2nd Sunday of May", () => {
    const occ = computeHolidayOccurrencesForYear("us_holidays", 2026).find((h) => h.key === "mothers_day_us");
    expect(occ).toBeDefined();
    expect(occ!.date.getUTCDay()).toBe(0); // Sunday
    // May 2026: May 1 is a Friday, so the 1st Sunday is May 3, the 2nd is May 10.
    expect(holidayDateKey(occ!.date)).toBe("2026-05-10");
  });

  it("computes Thanksgiving (US) as the 4th Thursday of November", () => {
    const occ = computeHolidayOccurrencesForYear("us_holidays", 2026).find((h) => h.key === "thanksgiving_us");
    expect(occ).toBeDefined();
    expect(occ!.date.getUTCDay()).toBe(4); // Thursday
    expect(holidayDateKey(occ!.date)).toBe("2026-11-26");
  });

  it("computes Black Friday as exactly one day after Thanksgiving, and Cyber Monday as exactly the following Monday", () => {
    const occ = computeHolidayOccurrencesForYear("us_holidays", 2026);
    const thanksgiving = occ.find((h) => h.key === "thanksgiving_us")!;
    const blackFriday = occ.find((h) => h.key === "black_friday")!;
    const cyberMonday = occ.find((h) => h.key === "cyber_monday")!;
    expect((blackFriday.date.getTime() - thanksgiving.date.getTime()) / 86400000).toBe(1);
    expect(blackFriday.date.getUTCDay()).toBe(5); // Friday
    expect((cyberMonday.date.getTime() - thanksgiving.date.getTime()) / 86400000).toBe(4);
    expect(cyberMonday.date.getUTCDay()).toBe(1); // Monday
  });

  it("includes Father's Day (3rd Sunday of June), shared with uk_holidays", () => {
    const usOcc = computeHolidayOccurrencesForYear("us_holidays", 2026).find((h) => h.key === "fathers_day");
    const ukOcc = computeHolidayOccurrencesForYear("uk_holidays", 2026).find((h) => h.key === "fathers_day");
    expect(usOcc).toBeDefined();
    expect(ukOcc).toBeDefined();
    expect(usOcc!.date.getUTCDay()).toBe(0); // Sunday
    expect(holidayDateKey(usOcc!.date)).toBe(holidayDateKey(ukOcc!.date)); // same real-world date under both calendars
  });
});

describe("computeHolidayOccurrencesForYear('uk_holidays') - Mothering Sunday differs from the US date", () => {
  it("computes UK Mothering Sunday as 21 days before Easter Sunday, a different date from US Mother's Day", () => {
    const ukMothersDay = computeHolidayOccurrencesForYear("uk_holidays", 2026).find((h) => h.key === "mothering_sunday_uk");
    const usMothersDay = computeHolidayOccurrencesForYear("us_holidays", 2026).find((h) => h.key === "mothers_day_us");
    const easter = computeHolidayOccurrencesForYear("international_holidays", 2026).find((h) => h.key === "easter");
    expect(ukMothersDay).toBeDefined();
    expect(usMothersDay).toBeDefined();
    expect(ukMothersDay!.date.getUTCDay()).toBe(0); // Sunday
    expect((easter!.date.getTime() - ukMothersDay!.date.getTime()) / 86400000).toBe(21);
    // UK Mothering Sunday (mid-March, tied to Lent/Easter) is a
    // genuinely different real-world date from the US's fixed 2nd-Sunday-
    // of-May convention - the two must never collapse to the same date.
    expect(holidayDateKey(ukMothersDay!.date)).not.toBe(holidayDateKey(usMothersDay!.date));
  });
});

describe("HOLIDAY_CATALOG - extended catalog invariants", () => {
  it("every relativeToKey entry's baseKey resolves to an existing catalog entry in the same calendar", () => {
    for (const entry of HOLIDAY_CATALOG) {
      const match = entry.match;
      if (match.type !== "relativeToKey") continue;
      const baseKey = match.baseKey;
      const base = HOLIDAY_CATALOG.find((e) => e.key === baseKey);
      expect(base, `relativeToKey base "${baseKey}" for "${entry.key}" must exist`).toBeDefined();
      for (const cal of entry.calendarKeys) {
        expect(base!.calendarKeys, `base "${baseKey}" must share calendar "${cal}" with "${entry.key}"`).toContain(cal);
      }
    }
  });

  it("HOLIDAY_CALENDAR_LABELS has an entry for every calendarKey referenced by the catalog", () => {
    const referencedKeys = new Set(HOLIDAY_CATALOG.flatMap((h) => h.calendarKeys));
    for (const key of referencedKeys) {
      expect(HOLIDAY_CALENDAR_LABELS[key], `missing label for calendarKey "${key}"`).toBeTruthy();
    }
  });
});
