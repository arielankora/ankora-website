// Phase 10: Important Dates ("מועדים חשובים") - pure recurrence engine.
//
// Deliberately has ZERO Prisma import (not even `import type` from
// "@prisma/client") so it is unit-testable in any environment, including
// this sandbox where `prisma generate` cannot run (see docs/adr/0001,
// "Known limitations"). The string-literal unions below are written to be
// structurally identical to the generated `CalendarType`/`RecurrenceType`
// enums, so passing an actual Prisma enum value from a caller in
// lib/app-domain/important-dates.ts type-checks with no conversion.
//
// Spec's named edge cases, and how each is handled here:
//   - Gregorian Feb 29 in a non-leap target year: defaults to Feb 28,
//     unless `leapDayUseMarchFirst` is set (then March 1). Mirrors
//     ImportantDate.leapDayUseMarchFirst in prisma/schema.prisma.
//   - Hebrew Adar in a leap target year (13 months: Adar I + Adar II):
//     defaults to Adar II, unless `hebrewAdarTwoInLeapYear` is false (then
//     Adar I). Mirrors ImportantDate.hebrewAdarTwoInLeapYear.
//   - DST: every computed occurrence is converted from a wall-clock
//     calendar date to a UTC instant via lib/timezone.ts's
//     `localDateTimeToUtc`, which is explicitly DST-correct (see that
//     file's own header comment for the bug it fixes) - so "the date" is
//     always midnight Asia/Jerusalem on the intended calendar day, never
//     off by an hour across a DST boundary.
//   - Year rollover: every "next occurrence" search starts at the
//     candidate in `fromDate`'s own year and walks forward (year, year+1,
//     ...) until it finds a candidate whose calendar day is >= `fromDate`'s
//     calendar day - naturally spans Dec->Jan / Hebrew year boundaries
//     with no special-casing needed.
//
// Library: @hebcal/core@5.9.2 (package.json, `--save-exact`) - the
// "mature, maintained" Hebrew-calendar library the spec required instead
// of hand-rolled conversion. Used purely for date <-> date arithmetic
// (HDate, HDate.isLeapYear, HDate.daysInMonth, the `months` constants);
// its own Hebrew rendering (`.render('he')`) is niqqud-heavy and not used
// here - UI-facing Hebrew labels are written by hand elsewhere
// (important-dates-holidays.ts, important-dates-reminders.ts).

import "server-only";
import { HDate, months as HebrewMonth } from "@hebcal/core";
import { localDateTimeToUtc, localDateKey, TIMEZONE } from "@/lib/timezone";
import { addDaysToKey, rollToBusinessDay, subtractBusinessDays, weekdayOfKey, isBusinessCalendarKey, type RollConventionLike } from "@/lib/business-calendar";

export type CalendarTypeLike = "GREGORIAN" | "HEBREW";
export type RecurrenceTypeLike = "ONCE" | "ANNUAL" | "MONTHLY" | "CUSTOM_INTERVAL" | "WEEKLY";
export type { RollConventionLike };

/// Every N months for a Gregorian MONTHLY date. Only divisors of 12, so the
/// cycle lines up with the year and needs no anchor year: "quarterly" is 3,
/// and a quarterly date set in January also falls in April, July, October.
export const ALLOWED_INTERVAL_MONTHS: readonly number[] = [1, 2, 3, 4, 6] as const;

export interface RecurrenceInput {
  calendarType: CalendarTypeLike;
  /** Gregorian: 1-12. Hebrew: a `months.*` constant from @hebcal/core (Adar stored as ADAR_I - see resolveHebrewMonthForYear). */
  month: number;
  /** Gregorian: 1-31. Hebrew: 1-30. */
  day: number;
  recurrence: RecurrenceTypeLike;
  /** Only meaningful when recurrence === "ONCE". */
  onceDate?: Date | null;
  /** Only meaningful when recurrence === "CUSTOM_INTERVAL". */
  customIntervalDays?: number | null;
  /** The calendar year (Gregorian or Hebrew, matching `calendarType`) the date was first set for - used for CUSTOM_INTERVAL's anchor and for elapsed-years display. */
  originYear?: number | null;
  leapDayUseMarchFirst?: boolean;
  hebrewAdarTwoInLeapYear?: boolean;
  timezone?: string;
  /** WEEKLY only: 0 = Sunday ... 6 = Saturday. */
  weekday?: number | null;
  /** Gregorian MONTHLY only: every N months, N in ALLOWED_INTERVAL_MONTHS. `month` is the anchor month. Null or 1 is every month. */
  intervalMonths?: number | null;
  /** Where an occurrence that falls on a non-business day moves. Null or NONE: it stays. */
  rollConvention?: RollConventionLike | null;
  /** "IL" or "US". Unknown values fall back to "IL". Only read when rollConvention moves dates. */
  businessCalendar?: string | null;
  /** UNKNOWN: never scheduled. APPROXIMATE and EXACT schedule on `day`. */
  precision?: DatePrecisionLike | null;
  /** No occurrence before this calendar day. */
  rangeStart?: Date | null;
  /** No occurrence after this calendar day. */
  rangeEnd?: Date | null;
}

export type DatePrecisionLike = "EXACT" | "APPROXIMATE" | "UNKNOWN";

const DAYS_IN_GREGORIAN_MONTH = (year: number, month1to12: number): number =>
  new Date(Date.UTC(year, month1to12, 0)).getUTCDate();

function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/// Resolves a stored Gregorian (month, day) against a specific target
/// year, handling the Feb 29 edge case. All other (month, day) pairs pass
/// through unchanged unless the day overflows the target month's length
/// (defensive clamp to the last day of that month - not spec'd explicitly,
/// but the only sane behavior for e.g. a day=31 date landing on a
/// 30-day month).
export function resolveGregorianDayForYear(
  month: number,
  day: number,
  year: number,
  leapDayUseMarchFirst = false
): { month: number; day: number } {
  if (month === 2 && day === 29 && !isGregorianLeapYear(year)) {
    return leapDayUseMarchFirst ? { month: 3, day: 1 } : { month: 2, day: 28 };
  }
  const lastDay = DAYS_IN_GREGORIAN_MONTH(year, month);
  return day > lastDay ? { month, day: lastDay } : { month, day };
}

function ymd(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function toUtcMidnight(year: number, month: number, day: number, timezone: string): Date {
  return localDateTimeToUtc(ymd(year, month, day), "00:00", timezone);
}

function todayLocalYmd(fromDate: Date, timezone: string): { year: number; month: number; day: number } {
  const key = localDateKey(fromDate, timezone); // YYYY-MM-DD
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

// ---------------------------------------------------------------------------
// Gregorian recurrence
// ---------------------------------------------------------------------------

function nextAnnualGregorian(
  month: number,
  day: number,
  fromDate: Date,
  leapDayUseMarchFirst: boolean,
  timezone: string
): Date {
  const { year: fromYear } = todayLocalYmd(fromDate, timezone);
  const fromKey = localDateKey(fromDate, timezone);
  for (let year = fromYear; year <= fromYear + 1; year++) {
    const resolved = resolveGregorianDayForYear(month, day, year, leapDayUseMarchFirst);
    const candidate = toUtcMidnight(year, resolved.month, resolved.day, timezone);
    if (localDateKey(candidate, timezone) >= fromKey) return candidate;
  }
  // Unreachable in practice (a full year always contains >= 1 match), but
  // keep TypeScript happy and fail safe rather than throw.
  const resolved = resolveGregorianDayForYear(month, day, fromYear + 2, leapDayUseMarchFirst);
  return toUtcMidnight(fromYear + 2, resolved.month, resolved.day, timezone);
}

function nextMonthlyGregorian(day: number, fromDate: Date, timezone: string, anchorMonth = 1, intervalMonths = 1): Date {
  const { year: fromYear, month: fromMonth } = todayLocalYmd(fromDate, timezone);
  const fromKey = localDateKey(fromDate, timezone);
  const interval = ALLOWED_INTERVAL_MONTHS.includes(intervalMonths) ? intervalMonths : 1;
  for (let i = 0; i <= 12; i++) {
    const totalMonth = fromMonth - 1 + i; // 0-based
    const year = fromYear + Math.floor(totalMonth / 12);
    const month = (totalMonth % 12) + 1;
    // Every N months, counted from the anchor month. N divides 12, so the
    // year never matters.
    if (interval > 1 && (((month - anchorMonth) % interval) + interval) % interval !== 0) continue;
    const lastDay = DAYS_IN_GREGORIAN_MONTH(year, month);
    const resolvedDay = Math.min(day, lastDay);
    const candidate = toUtcMidnight(year, month, resolvedDay, timezone);
    if (localDateKey(candidate, timezone) >= fromKey) return candidate;
  }
  // Fallback - should not be reached given the loop covers a full year.
  return toUtcMidnight(fromYear + 1, fromMonth, Math.min(day, DAYS_IN_GREGORIAN_MONTH(fromYear + 1, fromMonth)), timezone);
}

/// WEEKLY: the next given weekday on or after `fromDate`'s calendar day.
/// Org-brain spec 3.10: "every Thursday" anchored to the weekday, which
/// CUSTOM_INTERVAL of 7 days cannot promise (it depends on the start date).
function nextWeeklyGregorian(weekday: number, fromDate: Date, timezone: string): Date | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  const fromKey = localDateKey(fromDate, timezone);
  const offset = (weekday - weekdayOfKey(fromKey) + 7) % 7;
  const key = addDaysToKey(fromKey, offset);
  const [year, month, day] = key.split("-").map(Number);
  return toUtcMidnight(year, month, day, timezone);
}

/// Adds `days` to a `YYYY-MM-DD` calendar date using pure calendar (UTC)
/// arithmetic - never millisecond arithmetic on a local-midnight instant,
/// which would drift by an hour across a DST transition (the whole point
/// of the DST edge case the spec calls out).
function addDaysToCalendarDate(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function nextCustomIntervalGregorian(
  anchor: { year: number; month: number; day: number },
  intervalDays: number,
  fromDate: Date,
  timezone: string
): Date {
  if (intervalDays <= 0) {
    // Defensive: a non-positive interval can't recur. Treat as "today".
    return toUtcMidnight(anchor.year, anchor.month, anchor.day, timezone);
  }
  const fromKey = localDateKey(fromDate, timezone);
  let candidate = anchor;
  let candidateKey = ymd(candidate.year, candidate.month, candidate.day);
  // Fast-forward in large jumps first so a decade-old anchor doesn't need
  // thousands of loop iterations, then step day-by-day near the target.
  if (candidateKey < fromKey) {
    const roughDays = Math.floor(
      (Date.UTC(...(fromKey.split("-").map(Number) as [number, number, number])) -
        Date.UTC(candidate.year, candidate.month - 1, candidate.day)) /
        86_400_000
    );
    const jumps = Math.max(0, Math.floor(roughDays / intervalDays) - 1);
    if (jumps > 0) candidate = addDaysToCalendarDate(candidate.year, candidate.month, candidate.day, jumps * intervalDays);
  }
  candidateKey = ymd(candidate.year, candidate.month, candidate.day);
  while (candidateKey < fromKey) {
    candidate = addDaysToCalendarDate(candidate.year, candidate.month, candidate.day, intervalDays);
    candidateKey = ymd(candidate.year, candidate.month, candidate.day);
  }
  return toUtcMidnight(candidate.year, candidate.month, candidate.day, timezone);
}

// ---------------------------------------------------------------------------
// Hebrew recurrence (@hebcal/core)
// ---------------------------------------------------------------------------

/// Resolves a stored Hebrew month against a specific target Hebrew year.
/// Non-Adar months pass through unchanged. For Adar (stored as either
/// ADAR_I or ADAR_II - see the module header comment): a non-leap target
/// year has only one Adar, so it always resolves to ADAR_I; a leap target
/// year has both, and resolves to ADAR_II unless `hebrewAdarTwoInLeapYear`
/// is explicitly false.
export function resolveHebrewMonthForYear(storedMonth: number, hebrewYear: number, hebrewAdarTwoInLeapYear = true): number {
  const isAdar = storedMonth === HebrewMonth.ADAR_I || storedMonth === HebrewMonth.ADAR_II;
  if (!isAdar) return storedMonth;
  const isLeap = HDate.isLeapYear(hebrewYear);
  if (!isLeap) return HebrewMonth.ADAR_I;
  return hebrewAdarTwoInLeapYear ? HebrewMonth.ADAR_II : HebrewMonth.ADAR_I;
}

function daysInHebrewMonth(month: number, year: number): number {
  // @hebcal/core exposes this as a static helper on HDate.
  return HDate.daysInMonth(month, year);
}

/// Converts a resolved Hebrew (year, month, day) to the equivalent
/// Gregorian UTC-midnight instant, DST-safe, via lib/timezone.ts.
function hebrewToUtcMidnight(hebrewYear: number, hebrewMonth: number, hebrewDay: number, timezone: string): Date {
  const hd = new HDate(hebrewDay, hebrewMonth, hebrewYear);
  const g = hd.greg(); // JS Date - read with LOCAL getters (matches how @hebcal/core itself constructs it).
  return toUtcMidnight(g.getFullYear(), g.getMonth() + 1, g.getDate(), timezone);
}

function nextAnnualHebrew(
  storedMonth: number,
  storedDay: number,
  fromDate: Date,
  hebrewAdarTwoInLeapYear: boolean,
  timezone: string
): Date {
  const fromHebrewYear = new HDate(fromDate).getFullYear();
  const fromKey = localDateKey(fromDate, timezone);
  for (let year = fromHebrewYear; year <= fromHebrewYear + 1; year++) {
    const month = resolveHebrewMonthForYear(storedMonth, year, hebrewAdarTwoInLeapYear);
    const day = Math.min(storedDay, daysInHebrewMonth(month, year));
    const candidate = hebrewToUtcMidnight(year, month, day, timezone);
    if (localDateKey(candidate, timezone) >= fromKey) return candidate;
  }
  const year = fromHebrewYear + 2;
  const month = resolveHebrewMonthForYear(storedMonth, year, hebrewAdarTwoInLeapYear);
  const day = Math.min(storedDay, daysInHebrewMonth(month, year));
  return hebrewToUtcMidnight(year, month, day, timezone);
}

/// MONTHLY Hebrew recurrence fires in every Hebrew month - including both
/// Adar I and Adar II separately in a leap year - so, unlike the ANNUAL
/// path, there is no "which Adar" choice to make here; the day simply
/// clamps to whatever length each visited month happens to have.
function nextMonthlyHebrew(storedDay: number, fromDate: Date, timezone: string): Date {
  const fromKey = localDateKey(fromDate, timezone);
  let cursor = new HDate(fromDate);
  for (let i = 0; i <= 13; i++) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const day = Math.min(storedDay, daysInHebrewMonth(month, year));
    const candidate = hebrewToUtcMidnight(year, month, day, timezone);
    if (localDateKey(candidate, timezone) >= fromKey) return candidate;
    cursor = cursor.add(1, "month"); // HDate.add correctly wraps 12/13-month leap years.
  }
  // Fallback, not expected to be reached given the loop covers > 1 year.
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  return hebrewToUtcMidnight(year, month, Math.min(storedDay, daysInHebrewMonth(month, year)), timezone);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Computes the next occurrence of an ImportantDate on or after `fromDate`
/// (inclusive - a date whose occurrence IS `fromDate`'s own calendar day
/// counts as "next", matching how the daily job wants to treat "due
/// today"). Returns `null` only for a ONCE date whose `onceDate` has
/// already passed - callers (the daily job / important-dates.ts) are
/// responsible for moving such a date to a terminal status; this function
/// stays pure and does not know about ImportantDateStatus.
export function computeNextOccurrence(input: RecurrenceInput, fromDate: Date): Date | null {
  // Org-brain spec 3.10: a date whose day is unknown is a gap, not a
  // schedule. Nothing is computed for it, so nothing fires.
  if (input.precision === "UNKNOWN") return null;
  const timezone = input.timezone || TIMEZONE;
  // A bounded recurrence: search from the start of the period when it has
  // not begun yet, and stop at its end.
  let from = fromDate;
  if (input.rangeStart && localDateKey(input.rangeStart, timezone) > localDateKey(fromDate, timezone)) from = input.rangeStart;
  const next = computeRolledOccurrence(input, from);
  if (next && input.rangeEnd && localDateKey(next, timezone) > localDateKey(input.rangeEnd, timezone)) return null;
  return next;
}

function computeRolledOccurrence(input: RecurrenceInput, fromDate: Date): Date | null {
  const timezone = input.timezone || TIMEZONE;
  const convention = input.rollConvention ?? "NONE";
  if (convention === "NONE") return computeRawNextOccurrence(input, fromDate);

  // Org-brain spec 3.10: an occurrence on a non-business day moves to the
  // business day before or after it. A date rolled BACK can land before
  // `fromDate` (the 10th is a Saturday, it is observed on Thursday the 8th,
  // and today is Friday the 9th). That occurrence is over, so the search
  // continues from the day after the raw one. Three rounds are plenty: a
  // roll moves a few days at most, and every recurrence is longer than that.
  const calendar = isBusinessCalendarKey(input.businessCalendar) ? input.businessCalendar : "IL";
  const fromKey = localDateKey(fromDate, timezone);
  let searchFrom = fromDate;
  for (let round = 0; round < 3; round++) {
    const raw = computeRawNextOccurrence(input, searchFrom);
    if (!raw) return null;
    const rawKey = localDateKey(raw, timezone);
    const rolledKey = rollToBusinessDay(rawKey, calendar, convention);
    if (rolledKey >= fromKey) {
      if (rolledKey === rawKey) return raw;
      const [y, m, d] = rolledKey.split("-").map(Number);
      return toUtcMidnight(y, m, d, timezone);
    }
    const [y, m, d] = addDaysToKey(rawKey, 1).split("-").map(Number);
    searchFrom = toUtcMidnight(y, m, d, timezone);
  }
  return null;
}

/// The next occurrence before any business-day roll. Exported for the
/// tests; callers want computeNextOccurrence.
export function computeRawNextOccurrence(input: RecurrenceInput, fromDate: Date): Date | null {
  const timezone = input.timezone || TIMEZONE;

  if (input.recurrence === "ONCE") {
    if (!input.onceDate) return null;
    const onceKey = localDateKey(input.onceDate, timezone);
    return onceKey >= localDateKey(fromDate, timezone) ? input.onceDate : null;
  }

  if (input.recurrence === "WEEKLY") {
    // Gregorian only by definition: a week is a week in either calendar.
    return nextWeeklyGregorian(input.weekday ?? -1, fromDate, timezone);
  }

  if (input.recurrence === "CUSTOM_INTERVAL") {
    const intervalDays = input.customIntervalDays ?? 0;
    if (intervalDays <= 0) return null;
    // Anchor: prefer originYear/month/day if present, else fall back to
    // treating (month, day) as this year's anchor (Gregorian only -
    // CUSTOM_INTERVAL is defined in the spec for generic day counts, which
    // only makes sense against a Gregorian anchor).
    const anchorYear = input.originYear ?? todayLocalYmd(fromDate, timezone).year;
    return nextCustomIntervalGregorian({ year: anchorYear, month: input.month, day: input.day }, intervalDays, fromDate, timezone);
  }

  if (input.calendarType === "HEBREW") {
    if (input.recurrence === "MONTHLY") {
      return nextMonthlyHebrew(input.day, fromDate, timezone);
    }
    // ANNUAL (default/only remaining case for Hebrew).
    return nextAnnualHebrew(input.month, input.day, fromDate, input.hebrewAdarTwoInLeapYear ?? true, timezone);
  }

  // GREGORIAN
  if (input.recurrence === "MONTHLY") {
    return nextMonthlyGregorian(input.day, fromDate, timezone, input.month, input.intervalMonths ?? 1);
  }
  // ANNUAL (default).
  return nextAnnualGregorian(input.month, input.day, fromDate, input.leapDayUseMarchFirst ?? false, timezone);
}

/// The recurrence fields of an ImportantDate row, as computeNextOccurrence
/// wants them. One place to build this, so a field added to the engine is
/// not silently dropped by one of its three callers (create, update, and
/// the daily job), which is what happened to nothing yet and is cheap to
/// keep that way.
export type RecurrenceRowLike = {
  calendarType: CalendarTypeLike;
  month: number;
  day: number;
  recurrence: RecurrenceTypeLike;
  onceDate: Date | null;
  customIntervalDays: number | null;
  originYear: number | null;
  leapDayUseMarchFirst: boolean;
  hebrewAdarTwoInLeapYear: boolean;
  timezone: string;
  weekday: number | null;
  intervalMonths: number | null;
  rollConvention: RollConventionLike;
  businessCalendar: string;
  precision: DatePrecisionLike;
  rangeStart: Date | null;
  rangeEnd: Date | null;
};

export function recurrenceInputFromRow(row: RecurrenceRowLike): RecurrenceInput {
  return {
    calendarType: row.calendarType,
    month: row.month,
    day: row.day,
    recurrence: row.recurrence,
    onceDate: row.onceDate,
    customIntervalDays: row.customIntervalDays,
    originYear: row.originYear,
    leapDayUseMarchFirst: row.leapDayUseMarchFirst,
    hebrewAdarTwoInLeapYear: row.hebrewAdarTwoInLeapYear,
    timezone: row.timezone,
    weekday: row.weekday,
    intervalMonths: row.intervalMonths,
    rollConvention: row.rollConvention,
    businessCalendar: row.businessCalendar,
    precision: row.precision,
    rangeStart: row.rangeStart,
    rangeEnd: row.rangeEnd,
  };
}

/// "8 או 9", "8, 9 או 10". For APPROXIMATE dates in lists and on the date
/// screen.
export function formatDayAlternatives(days: number[]): string {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted.join("");
  return `${sorted.slice(0, -1).join(", ")} או ${sorted[sorted.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Lead time ("open the task N days before")
// ---------------------------------------------------------------------------

export type LeadUnitLike = "CALENDAR_DAYS" | "BUSINESS_DAYS";

/// The day an auto-task for `occurrence` opens: `leadDays` before it, in
/// calendar days (the behavior since phase 10) or in business days of the
/// date's calendar (org-brain spec 3.10). Returned as local midnight of
/// that day, so "is it due" compares a day with a day.
export function computeLeadDate(
  occurrence: Date,
  leadDays: number,
  leadUnit: LeadUnitLike,
  businessCalendar: string | null | undefined,
  timezone: string = TIMEZONE
): Date {
  const occurrenceKey = localDateKey(occurrence, timezone);
  const days = Math.max(0, Math.floor(leadDays));
  const key =
    leadUnit === "BUSINESS_DAYS"
      ? subtractBusinessDays(occurrenceKey, days, isBusinessCalendarKey(businessCalendar) ? businessCalendar : "IL")
      : addDaysToKey(occurrenceKey, -days);
  const [y, m, d] = key.split("-").map(Number);
  return toUtcMidnight(y, m, d, timezone);
}

// ---------------------------------------------------------------------------
// Elapsed-years display ("בן/בת X", "X שנים לנישואין", etc.)
// ---------------------------------------------------------------------------

/// Elapsed calendar years between `originYear` and `occurrenceYear`, both
/// expressed in the SAME calendar system (both Gregorian, or both Hebrew -
/// callers pass the occurrence's own Hebrew year for a Hebrew date, never
/// a mixed Gregorian/Hebrew subtraction, which would be meaningless).
/// Returns null when there is no origin year to compare against (an
/// ImportantDate is never required to set one - spec allows a bare
/// recurring date with no "since" year, e.g. a generic annual renewal).
export function computeElapsedYears(originYear: number | null | undefined, occurrenceYear: number): number | null {
  if (originYear == null) return null;
  const diff = occurrenceYear - originYear;
  return diff >= 0 ? diff : null;
}

/// Hebrew-correct pluralization for a year count: "שנה אחת" (1), "שנתיים"
/// (2, dual form - NOT "2 שנים"), "N שנים" (3+). Zero is treated as "0
/// שנים" (defensive - callers should not normally pass 0, since
/// computeElapsedYears never returns 0 for a same-year origin/occurrence
/// pair being meaningfully "an anniversary" yet, but it's a valid input
/// for e.g. a same-year custom counter).
export function formatElapsedYearsHebrew(years: number): string {
  if (years === 1) return "שנה אחת";
  if (years === 2) return "שנתיים";
  return `${years} שנים`;
}
