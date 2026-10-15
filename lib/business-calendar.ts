// Business days ("ימי עבודה"), for the org-brain spec
// (claude/org-brain-spec-2026-10-12.md, section 3.10 and decision 6).
//
// A recurring obligation is rarely "the 10th". It is "the 10th, or the
// working day before it if the 10th is a Saturday", and the work for it
// starts "three working days before". Calendar-day arithmetic gets both
// wrong, and wrong in the direction that hurts: a reminder that lands on a
// Friday in Israel, or a payment file due on Thanksgiving in the US.
//
// Pure: no Prisma, no clock, no time zone. Everything here works on
// calendar-date keys ("YYYY-MM-DD"), and the caller converts to and from
// instants with lib/timezone.ts, exactly as important-dates-recurrence.ts
// does. That keeps the arithmetic DST-proof for the same reason it is
// there: a calendar day is not 86,400,000 milliseconds twice a year.
//
// Two calendars, because that is what the clients we have need (NUX has an
// Israeli company and an American one). A third is a new entry in
// CALENDARS, never a schema change: ImportantDate.businessCalendar is a
// free string for the same reason ImportantDate.type is.

import { HebrewCalendar, flags } from "@hebcal/core";

export type BusinessCalendarKey = "IL" | "US";
export const BUSINESS_CALENDARS: readonly BusinessCalendarKey[] = ["IL", "US"] as const;

export const BUSINESS_CALENDAR_LABELS: Record<BusinessCalendarKey, string> = {
  IL: "ישראל (ראשון עד חמישי)",
  US: 'ארה"ב (שני עד שישי)',
};

export type RollConventionLike = "NONE" | "PREVIOUS_BUSINESS_DAY" | "NEXT_BUSINESS_DAY";

export function isBusinessCalendarKey(value: unknown): value is BusinessCalendarKey {
  return value === "IL" || value === "US";
}

// ---------------------------------------------------------------------------
// Date-key helpers
// ---------------------------------------------------------------------------

function parseKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

function toKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/// Calendar arithmetic on a key. UTC is used only as a neutral calendar,
/// never as a time zone: no instant leaves this function.
export function addDaysToKey(key: string, days: number): string {
  const { year, month, day } = parseKey(key);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return toKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/// 0 = Sunday ... 6 = Saturday, like Date.getDay.
export function weekdayOfKey(key: string): number {
  const { year, month, day } = parseKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

/// Israel: the days the law treats as rest days, which is what an office
/// is closed on. Every yom tov (Rosh Hashana I and II, Yom Kippur, Sukkot
/// I, Shmini Atzeret, Pesach I and VII, Shavuot), in Israeli mode so there
/// are no diaspora second days, and Yom HaAtzma'ut, with the postponement
/// rules @hebcal/core already applies.
///
/// Not included, on purpose: erev chag, chol hamoed, Purim, Yom HaZikaron.
/// Many offices shorten those days or run them thin, but they are working
/// days, and a business-day count that skips them would push work earlier
/// than anyone expects.
function israeliHolidays(year: number): string[] {
  const events = HebrewCalendar.calendar({ year, isHebrewYear: false, il: true });
  const out: string[] = [];
  for (const e of events) {
    const isYomTov = (e.getFlags() & flags.CHAG) !== 0;
    const isIndependenceDay = e.getDesc() === "Yom HaAtzma'ut";
    if (!isYomTov && !isIndependenceDay) continue;
    // @hebcal/core builds its Gregorian Date at local midnight; read it
    // back with local getters, same as important-dates-holidays.ts.
    const g = e.getDate().greg();
    out.push(toKey(g.getFullYear(), g.getMonth() + 1, g.getDate()));
  }
  return out;
}

/// The n-th given weekday of a month (n = 1..4), or the last one (n = -1).
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return toKey(year, month, day);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return toKey(year, month, lastDay - ((lastWeekday - weekday + 7) % 7));
}

/// A fixed-date federal holiday that falls on a weekend is observed on the
/// Friday before (Saturday) or the Monday after (Sunday). 5 U.S.C. 6103(b).
function observed(key: string): string {
  const wd = weekdayOfKey(key);
  if (wd === 6) return addDaysToKey(key, -1);
  if (wd === 0) return addDaysToKey(key, 1);
  return key;
}

/// United States: the eleven federal holidays of 5 U.S.C. 6103(a), as
/// observed. Computed from their fixed rules rather than pulled from a
/// library, because the rules are short, stable and checked in the tests.
///
/// New Year's Day of the FOLLOWING year is included when it is observed on
/// Dec 31 of this one (Jan 1 on a Saturday), so a lookup for this year
/// sees it.
function usFederalHolidays(year: number): string[] {
  const fixed = (y: number, m: number, d: number) => observed(toKey(y, m, d));
  const list = [
    fixed(year, 1, 1), // New Year's Day
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day: 3rd Monday of January
    nthWeekday(year, 2, 1, 3), // Washington's Birthday: 3rd Monday of February
    nthWeekday(year, 5, 1, -1), // Memorial Day: last Monday of May
    fixed(year, 6, 19), // Juneteenth
    fixed(year, 7, 4), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day: 1st Monday of September
    nthWeekday(year, 10, 1, 2), // Columbus Day: 2nd Monday of October
    fixed(year, 11, 11), // Veterans Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving: 4th Thursday of November
    fixed(year, 12, 25), // Christmas Day
  ];
  const nextNewYear = fixed(year + 1, 1, 1);
  if (nextNewYear.startsWith(`${year}-`)) list.push(nextNewYear);
  return list;
}

const holidayCache = new Map<string, Set<string>>();

function holidaysFor(calendar: BusinessCalendarKey, year: number): Set<string> {
  const cacheKey = `${calendar}:${year}`;
  let set = holidayCache.get(cacheKey);
  if (!set) {
    set = new Set(calendar === "IL" ? israeliHolidays(year) : usFederalHolidays(year));
    holidayCache.set(cacheKey, set);
  }
  return set;
}

const WEEKEND: Record<BusinessCalendarKey, readonly number[]> = {
  IL: [5, 6], // Friday, Saturday
  US: [6, 0], // Saturday, Sunday
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isBusinessDay(key: string, calendar: BusinessCalendarKey): boolean {
  if (WEEKEND[calendar].includes(weekdayOfKey(key))) return false;
  return !holidaysFor(calendar, parseKey(key).year).has(key);
}

/// Moves a day that is not a business day to the nearest one in the given
/// direction. A business day is returned unchanged. NONE never moves.
export function rollToBusinessDay(key: string, calendar: BusinessCalendarKey, convention: RollConventionLike): string {
  if (convention === "NONE") return key;
  const step = convention === "PREVIOUS_BUSINESS_DAY" ? -1 : 1;
  let cursor = key;
  // A run of non-business days is at most a few days long (a weekend
  // against a two-day chag). The bound only guards against a bug.
  for (let i = 0; i < 31 && !isBusinessDay(cursor, calendar); i++) cursor = addDaysToKey(cursor, step);
  return cursor;
}

/// The business day that is `count` business days before `key`, counting
/// only days strictly before it. "Three working days before Tuesday
/// 10.11.2026" in Israel is Thursday 5.11: Monday 9 is one, Sunday 8 is
/// two, Friday and Saturday do not count, Thursday 5 is three.
///
/// `count` of 0 returns `key` itself, whatever day it is.
export function subtractBusinessDays(key: string, count: number, calendar: BusinessCalendarKey): string {
  let cursor = key;
  let remaining = Math.max(0, Math.floor(count));
  let guard = 0;
  while (remaining > 0 && guard < 3660) {
    cursor = addDaysToKey(cursor, -1);
    if (isBusinessDay(cursor, calendar)) remaining--;
    guard++;
  }
  return cursor;
}

/// `count` business days after `key` (before it, when negative), counting
/// only days strictly after (before) it. 0 returns `key` itself. A step
/// "two business days before the payment run" is -2.
export function shiftBusinessDays(key: string, count: number, calendar: BusinessCalendarKey): string {
  const n = Math.trunc(count);
  if (n <= 0) return subtractBusinessDays(key, -n, calendar);
  let cursor = key;
  let remaining = n;
  let guard = 0;
  while (remaining > 0 && guard < 3660) {
    cursor = addDaysToKey(cursor, 1);
    if (isBusinessDay(cursor, calendar)) remaining--;
    guard++;
  }
  return cursor;
}
