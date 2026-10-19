import "server-only";

import type { ImportantDate } from "@prisma/client";
import { computeNextOccurrence, recurrenceInputFromRow } from "@/lib/app-domain/important-dates-recurrence";
import { computeHolidayOccurrencesForYear, HOLIDAY_CATALOG, type HolidayCalendarKey } from "@/lib/app-domain/important-dates-holidays";
import { dayStartInZone, localDateKey, TIMEZONE } from "@/lib/timezone";
import { addDays } from "@/lib/calendar-keys";

// The calendar's important-date occurrences, apart from calendar.ts so it
// has no Prisma import and its tests run anywhere (the same split as
// important-dates-recurrence.ts). See calendar.ts for why occurrences are
// computed rather than read from nextOccurrenceAt.

/// One walk of the recurrence engine is one occurrence. A daily-ish date
/// over a 6-week month grid is ~42; this is a fuse, not a limit.
const MAX_OCCURRENCES = 400;

export type OccurrenceRow = Pick<
  ImportantDate,
  | "calendarType"
  | "month"
  | "day"
  | "recurrence"
  | "onceDate"
  | "customIntervalDays"
  | "originYear"
  | "leapDayUseMarchFirst"
  | "hebrewAdarTwoInLeapYear"
  | "timezone"
  | "weekday"
  | "intervalMonths"
  | "rollConvention"
  | "businessCalendar"
  | "precision"
  | "rangeStart"
  | "rangeEnd"
  | "source"
  | "holidayKey"
>;

/// Every day, from `startKey` to `endKey` inclusive, on which this date
/// occurs. Keys in Israel time, ascending.
export function occurrencesInRange(row: OccurrenceRow, startKey: string, endKey: string): string[] {
  if (row.source === "HOLIDAY" && row.holidayKey) return holidayOccurrences(row.holidayKey, startKey, endKey);

  const input = recurrenceInputFromRow(row);
  const tz = row.timezone || TIMEZONE;
  const out: string[] = [];
  let cursor = dayStartInZone(startKey, tz);
  while (cursor && out.length < MAX_OCCURRENCES) {
    const next = computeNextOccurrence(input, cursor);
    if (!next) break;
    const key = localDateKey(next, tz);
    if (key > endKey) break;
    // The engine is inclusive of the cursor's day, so the next search
    // starts the day after this hit. A rolled-back occurrence before the
    // cursor is never returned by the engine, so this cannot loop.
    if (key >= startKey && out[out.length - 1] !== key) out.push(key);
    cursor = dayStartInZone(addDays(key, 1), tz);
  }
  return out;
}

function holidayOccurrences(holidayKey: string, startKey: string, endKey: string): string[] {
  const entry = HOLIDAY_CATALOG.find((e) => e.key === holidayKey);
  if (!entry) return [];
  // Any calendar the entry belongs to gives the same day; Israel's first
  // because it is the one with the Hebrew-calendar arithmetic.
  const calendarKey: HolidayCalendarKey = entry.calendarKeys.includes("il_holidays") ? "il_holidays" : entry.calendarKeys[0];
  const out: string[] = [];
  for (let year = Number(startKey.slice(0, 4)); year <= Number(endKey.slice(0, 4)); year++) {
    for (const occ of computeHolidayOccurrencesForYear(calendarKey, year)) {
      if (occ.key !== holidayKey) continue;
      const key = localDateKey(occ.date, TIMEZONE);
      if (key >= startKey && key <= endKey) out.push(key);
    }
  }
  return out;
}

