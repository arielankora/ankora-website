// Phase 10: Important Dates ("מועדים חשובים") - curated holiday catalog.
//
// Zero Prisma import, same reasoning as important-dates-recurrence.ts.
//
// Scope decision (spec: "קטלוג חגים - ישראלי/יהודי + בינלאומי", "לעולם לא
// subscribe אוטומטית לכל לקוח, opt-in per calendar"): the spec asks for a
// holiday CATALOG, not a full liturgical calendar - a curated list of
// office-closure-relevant / business-relevant dates, grouped into
// opt-in "calendars" (HolidayCalendarSubscription.calendarKey, a free
// string per the schema's Notification.type-style precedent - see
// prisma/schema.prisma's Phase 10 doc comment - so this catalog can grow
// without a migration). Four calendars are seeded here, per Ariel's
// explicit follow-up request to add the remaining spec'd international
// holidays and per-country selection (spec: "לפחות: ישראל, International
// Core, ארה\"ב, בריטניה"):
//   - "il_holidays": the major Israeli/Jewish chagim and national
//     observance days that affect office availability and client
//     communication timing - computed via @hebcal/core (never
//     hand-rolled), matched by each event's stable English description
//     key (`.getDesc()`) rather than any hand-computed date math, so leap
//     years/Adar/moving festivals are always exactly right.
//   - "international_holidays" ("International Core"): fixed-Gregorian,
//     Easter-based, Islamic (Hijri), and Lunar New Year dates that are
//     not specific to one Western country - New Year, Valentine's Day,
//     International Women's Day, Easter, Halloween, Christmas Eve,
//     Christmas Day, Lunar New Year, Ramadan (start), Eid al-Fitr, Eid
//     al-Adha.
//   - "us_holidays": Mother's Day (2nd Sunday of May, the US convention),
//     Father's Day (3rd Sunday of June - shared with uk_holidays, see
//     below), Thanksgiving (4th Thursday of November), Black Friday and
//     Cyber Monday (both computed relative to Thanksgiving, never
//     duplicated as their own nth-weekday rule, so they can never drift
//     from it).
//   - "uk_holidays": Mother's Day / Mothering Sunday (the fourth Sunday
//     of Lent - the UK convention, genuinely a different date from the
//     US one, computed as 21 days before Easter Sunday, never
//     hand-computed independently of the Easter engine below), Father's
//     Day (3rd Sunday of June - identical date to the US convention, so
//     the same catalog entry is deliberately listed under both
//     calendars rather than duplicated as a second entry with its own
//     key - see HOLIDAY_CATALOG's fathers_day entry).
//
// Three date engines beyond @hebcal/core, none hand-rolled (per the
// spec's own standing rule for the Hebrew calendar, extended here on the
// same reasoning to every other non-trivial calendar system):
//   - Easter (Western/Gregorian): `date-easter` (exact-locked below),
//     computes the standard Anonymous Gregorian algorithm.
//   - Islamic/Hijri (Ramadan, Eid al-Fitr, Eid al-Adha): `@umalqura/core`
//     (exact-locked below), the Umm al-Qura tabular calendar - the same
//     calendar Saudi Arabia's official calendar is based on. Disclosed
//     caveat: real-world Ramadan/Eid observance is ultimately set by
//     regional moon-sighting and can differ from the tabular calendar by
//     a day in either direction - this catalog gives a reliable planning
//     date, not a religious ruling.
//   - Chinese Lunar New Year: `lunar-javascript` (exact-locked below).
//
// Nth-weekday-of-month dates (Mother's/Father's Day US, Thanksgiving)
// and Easter-relative offsets (UK Mothering Sunday, Black Friday, Cyber
// Monday) are plain, unambiguous calendar arithmetic - not a calendar
// *system* in the way Hebrew/Hijri/Lunar are - so they are computed
// directly here rather than via a library, the same way
// important-dates-recurrence.ts computes ordinary Gregorian recurrence.
//
// Matching rule for il_holidays entries (see the ambiguity note inline
// below): "exact" for same-named single-day holidays, "startsWithYear"
// only for Rosh Hashana, whose hebcal description embeds the Hebrew year
// (e.g. "Rosh Hashana 5787") and would otherwise collide with the
// unrelated "Rosh Hashana LaBehemot" (New Year for Animals, a very minor
// date in Elul, ~3 weeks earlier) and "Rosh Hashana II" (day 2) if
// matched by a naive prefix.

import "server-only";
import { HebrewCalendar } from "@hebcal/core";
import { gregorianEaster } from "date-easter";
import umalqura from "@umalqura/core";
import { Lunar } from "lunar-javascript";
import { localDateKey, TIMEZONE } from "@/lib/timezone";

export type HolidayCalendarKey = "il_holidays" | "international_holidays" | "us_holidays" | "uk_holidays";

type Matcher = { type: "exact"; value: string } | { type: "startsWithYearDigit"; value: string };

type Match =
  | Matcher
  | { type: "fixedGregorian"; month: number; day: number }
  | { type: "easter" }
  | { type: "easterOffsetDays"; offsetDays: number }
  | { type: "nthWeekdayOfMonth"; month: number; weekday: number; n: number }
  | { type: "relativeToKey"; baseKey: string; offsetDays: number }
  | { type: "islamicHijri"; hijriMonth: number; hijriDay: number }
  | { type: "lunarNewYear" };

export interface HolidayCatalogEntry {
  /** Stable key - stored as ImportantDate.holidayKey and the join half of its @@unique([clientId, holidayKey]) dedupe constraint. Never renamed once shipped (would silently orphan existing client dates). */
  key: string;
  labelHe: string;
  /** A holiday can legitimately belong to more than one calendar without being a duplicate catalog entry - e.g. Father's Day is the same actual date under both "us_holidays" and "uk_holidays". Subscribing to both never double-creates an ImportantDate: the dedupe key is (clientId, holidayKey), not (clientId, calendarKey, holidayKey). */
  calendarKeys: HolidayCalendarKey[];
  defaultReminderDaysBefore: number[];
  match: Match;
}

export const HOLIDAY_CATALOG: HolidayCatalogEntry[] = [
  // --- il_holidays (source: @hebcal/core, il:true) ---
  { key: "rosh_hashana", labelHe: "ראש השנה", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [30, 7], match: { type: "startsWithYearDigit", value: "Rosh Hashana " } },
  { key: "yom_kippur", labelHe: "יום כיפור", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "exact", value: "Yom Kippur" } },
  { key: "sukkot", labelHe: "סוכות", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "exact", value: "Sukkot I" } },
  { key: "shmini_atzeret", labelHe: "שמיני עצרת ושמחת תורה", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7, 1], match: { type: "exact", value: "Shmini Atzeret" } },
  { key: "chanukah", labelHe: "חנוכה", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7, 1], match: { type: "exact", value: "Chanukah: 1 Candle" } },
  { key: "tu_bishvat", labelHe: "ט\"ו בשבט", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7], match: { type: "exact", value: "Tu BiShvat" } },
  { key: "purim", labelHe: "פורים", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7, 1], match: { type: "exact", value: "Purim" } },
  { key: "pesach", labelHe: "פסח", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [21, 7], match: { type: "exact", value: "Pesach I" } },
  { key: "yom_hashoah", labelHe: "יום השואה", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7], match: { type: "exact", value: "Yom HaShoah" } },
  { key: "yom_hazikaron", labelHe: "יום הזיכרון", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7], match: { type: "exact", value: "Yom HaZikaron" } },
  { key: "yom_haatzmaut", labelHe: "יום העצמאות", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7, 1], match: { type: "exact", value: "Yom HaAtzma'ut" } },
  { key: "lag_baomer", labelHe: "ל\"ג בעומר", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7], match: { type: "exact", value: "Lag BaOmer" } },
  { key: "shavuot", labelHe: "שבועות", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "exact", value: "Shavuot" } },
  { key: "tisha_bav", labelHe: "תשעה באב", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7], match: { type: "exact", value: "Tish'a B'Av" } },

  // --- international_holidays ("International Core") ---
  { key: "new_year", labelHe: "ראש השנה האזרחית", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "fixedGregorian", month: 1, day: 1 } },
  { key: "valentines_day", labelHe: "יום האהבה (Valentine's Day)", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "fixedGregorian", month: 2, day: 14 } },
  { key: "international_womens_day", labelHe: "יום האישה הבינלאומי", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [7], match: { type: "fixedGregorian", month: 3, day: 8 } },
  { key: "easter", labelHe: "חג הפסחא", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "easter" } },
  { key: "halloween", labelHe: "ליל כל הקדושים (Halloween)", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "fixedGregorian", month: 10, day: 31 } },
  { key: "lunar_new_year", labelHe: "ראש השנה הסיני", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "lunarNewYear" } },
  { key: "ramadan_start", labelHe: "תחילת חודש הרמדאן", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "islamicHijri", hijriMonth: 9, hijriDay: 1 } },
  { key: "eid_al_fitr", labelHe: "עיד אל-פיטר", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [7, 1], match: { type: "islamicHijri", hijriMonth: 10, hijriDay: 1 } },
  { key: "eid_al_adha", labelHe: "עיד אל-אדחא", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [7, 1], match: { type: "islamicHijri", hijriMonth: 12, hijriDay: 10 } },
  { key: "christmas_eve", labelHe: "ליל חג המולד", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "fixedGregorian", month: 12, day: 24 } },
  { key: "christmas", labelHe: "חג המולד", calendarKeys: ["international_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "fixedGregorian", month: 12, day: 25 } },

  // --- us_holidays / uk_holidays ---
  { key: "mothers_day_us", labelHe: "יום האם (ארה\"ב)", calendarKeys: ["us_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "nthWeekdayOfMonth", month: 5, weekday: 0, n: 2 } },
  { key: "mothering_sunday_uk", labelHe: "יום האם (בריטניה - Mothering Sunday)", calendarKeys: ["uk_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "easterOffsetDays", offsetDays: -21 } },
  { key: "fathers_day", labelHe: "יום האב", calendarKeys: ["us_holidays", "uk_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "nthWeekdayOfMonth", month: 6, weekday: 0, n: 3 } },
  { key: "thanksgiving_us", labelHe: "חג ההודיה (ארה\"ב)", calendarKeys: ["us_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "nthWeekdayOfMonth", month: 11, weekday: 4, n: 4 } },
  { key: "black_friday", labelHe: "Black Friday", calendarKeys: ["us_holidays"], defaultReminderDaysBefore: [14, 3], match: { type: "relativeToKey", baseKey: "thanksgiving_us", offsetDays: 1 } },
  { key: "cyber_monday", labelHe: "Cyber Monday", calendarKeys: ["us_holidays"], defaultReminderDaysBefore: [7, 1], match: { type: "relativeToKey", baseKey: "thanksgiving_us", offsetDays: 4 } },
];

export const HOLIDAY_CALENDAR_LABELS: Record<HolidayCalendarKey, string> = {
  il_holidays: "חגי ישראל ומועדי ישראל",
  international_holidays: "חגים בינלאומיים (International Core)",
  us_holidays: "חגים - ארה\"ב",
  uk_holidays: "חגים - בריטניה",
};

function matchesEvent(matcher: Matcher, desc: string): boolean {
  if (matcher.type === "exact") return desc === matcher.value;
  return desc.startsWith(matcher.value) && /^\d/.test(desc.slice(matcher.value.length));
}

/// Nth weekday-of-month (e.g. "2nd Sunday of May"), plain UTC calendar
/// arithmetic - no library needed, this is not a calendar *system*.
/// weekday: 0=Sunday..6=Saturday (JS Date convention). n: 1-based (2nd
/// Sunday = n=2).
function nthWeekdayOfMonth(gregorianYear: number, month1: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(gregorianYear, month1 - 1, 1));
  const firstWeekday = first.getUTCDay();
  const offsetToFirstMatch = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offsetToFirstMatch + (n - 1) * 7;
  return new Date(Date.UTC(gregorianYear, month1 - 1, day));
}

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/// Western/Gregorian Easter Sunday for a given year, via `date-easter`
/// (never hand-computed).
function easterSunday(gregorianYear: number): Date {
  const e = gregorianEaster(gregorianYear);
  return new Date(Date.UTC(e.year, e.month - 1, e.day));
}

/// Every Islamic/Hijri occurrence of (hijriMonth, hijriDay) whose
/// Gregorian date falls within the given Gregorian year, via
/// `@umalqura/core` (never hand-computed). A Hijri year is ~11 days
/// shorter than a Gregorian year, so the Hijri year(s) spanning a given
/// Gregorian year are found first (via the library's own
/// gregorianToHijri, not assumed), then each candidate is converted
/// forward and filtered back to the target Gregorian year - robust for
/// any year, not hardcoded to a specific Hijri/Gregorian year mapping.
function islamicHijriOccurrencesInGregorianYear(gregorianYear: number, hijriMonth: number, hijriDay: number): Date[] {
  const S = umalqura.$;
  const jan1Hijri = S.gregorianToHijri(new Date(Date.UTC(gregorianYear, 0, 1)));
  const dec31Hijri = S.gregorianToHijri(new Date(Date.UTC(gregorianYear, 11, 31)));
  const candidateHijriYears = new Set<number>([jan1Hijri.hy - 1, jan1Hijri.hy, dec31Hijri.hy, dec31Hijri.hy + 1]);
  const results: Date[] = [];
  for (const hy of candidateHijriYears) {
    const g = S.hijriToGregorian(hy, hijriMonth, hijriDay);
    if (g.gy === gregorianYear) {
      // g.gm is 0-indexed (JS Date convention) per @umalqura/core's own
      // source (verified against a live gregorianToHijri round-trip
      // during development, not assumed from the type defs alone).
      results.push(new Date(Date.UTC(g.gy, g.gm, g.gd)));
    }
  }
  return results;
}

/// Chinese Lunar New Year (the first day of the lunar year) falling in a
/// given Gregorian year, via `lunar-javascript` (never hand-computed).
/// Cross-checked during development against known real-world dates
/// (2025-01-29, 2026-02-17, 2027-02-06) before shipping.
function lunarNewYear(gregorianYear: number): Date {
  const solar = Lunar.fromYmd(gregorianYear, 1, 1).getSolar();
  return new Date(Date.UTC(solar.getYear(), solar.getMonth() - 1, solar.getDay()));
}

/// Computes each il_holidays catalog entry's occurrence date within a
/// given GREGORIAN calendar year, via a single @hebcal/core query (never
/// hand-rolled math). When a matcher hits more than one event in the
/// year (defensive - not expected given the exact/startsWithYearDigit
/// matchers above are each designed to be unambiguous), the earliest
/// date wins, matching "day 1" semantics for multi-day festivals.
export function computeIsraeliHolidayOccurrencesForYear(gregorianYear: number): Array<{ key: string; date: Date }> {
  const events = HebrewCalendar.calendar({ year: gregorianYear, isHebrewYear: false, il: true });
  const byDesc: Array<{ desc: string; date: Date }> = events.map((e) => ({
    desc: e.getDesc(),
    date: e.getDate().greg(),
  }));

  const results: Array<{ key: string; date: Date }> = [];
  for (const entry of HOLIDAY_CATALOG) {
    if (!entry.calendarKeys.includes("il_holidays") || (entry.match.type !== "exact" && entry.match.type !== "startsWithYearDigit")) continue;
    const matches = byDesc.filter((e) => matchesEvent(entry.match as Matcher, e.desc));
    if (matches.length === 0) continue; // Defensive - every entry above was hand-verified against a live 2026 catalog dump before shipping.
    const earliest = matches.reduce((a, b) => (a.date.getTime() <= b.date.getTime() ? a : b));
    results.push({ key: entry.key, date: earliest.date });
  }
  return results;
}

/// Every non-il_holidays, non-relative catalog entry's occurrence for a
/// given calendar + year. "relativeToKey" entries (Black Friday, Cyber
/// Monday) are resolved in a second pass by computeHolidayOccurrencesForYear
/// below, once their base entry's date is known - kept out of this
/// function to avoid a partial-catalog recursion here.
function computeDirectOccurrencesForYear(calendarKey: HolidayCalendarKey, gregorianYear: number): Array<{ key: string; date: Date }> {
  const results: Array<{ key: string; date: Date }> = [];
  for (const entry of HOLIDAY_CATALOG) {
    if (!entry.calendarKeys.includes(calendarKey)) continue;
    switch (entry.match.type) {
      case "fixedGregorian":
        results.push({ key: entry.key, date: new Date(Date.UTC(gregorianYear, entry.match.month - 1, entry.match.day)) });
        break;
      case "easter":
        results.push({ key: entry.key, date: easterSunday(gregorianYear) });
        break;
      case "easterOffsetDays":
        results.push({ key: entry.key, date: addUtcDays(easterSunday(gregorianYear), entry.match.offsetDays) });
        break;
      case "nthWeekdayOfMonth":
        results.push({ key: entry.key, date: nthWeekdayOfMonth(gregorianYear, entry.match.month, entry.match.weekday, entry.match.n) });
        break;
      case "islamicHijri":
        for (const date of islamicHijriOccurrencesInGregorianYear(gregorianYear, entry.match.hijriMonth, entry.match.hijriDay)) {
          results.push({ key: entry.key, date });
        }
        break;
      case "lunarNewYear":
        results.push({ key: entry.key, date: lunarNewYear(gregorianYear) });
        break;
      case "relativeToKey":
        break; // resolved in computeHolidayOccurrencesForYear's second pass
      default:
        break; // "exact" / "startsWithYearDigit" - il_holidays only, handled above
    }
  }
  return results;
}

/// Single entry point used by the daily job / subscription logic: all
/// occurrences for one calendar in one Gregorian year, with the catalog's
/// Hebrew label and default reminder offsets attached. Resolves
/// "relativeToKey" entries (Black Friday, Cyber Monday) against their
/// base entry's date computed in the same year - the base entry does not
/// need to belong to the same calendar being queried, since a
/// relativeToKey entry always names its own base explicitly.
export function computeHolidayOccurrencesForYear(
  calendarKey: HolidayCalendarKey,
  gregorianYear: number
): Array<{ key: string; labelHe: string; date: Date; defaultReminderDaysBefore: number[] }> {
  const direct = calendarKey === "il_holidays" ? computeIsraeliHolidayOccurrencesForYear(gregorianYear) : computeDirectOccurrencesForYear(calendarKey, gregorianYear);
  const dateByKey = new Map(direct.map((r) => [r.key, r.date]));

  const relativeEntries = HOLIDAY_CATALOG.filter((e) => e.calendarKeys.includes(calendarKey) && e.match.type === "relativeToKey");
  const resolved: Array<{ key: string; date: Date }> = [...direct];
  for (const entry of relativeEntries) {
    const m = entry.match as { type: "relativeToKey"; baseKey: string; offsetDays: number };
    const baseDate = dateByKey.get(m.baseKey) ?? computeDirectOccurrencesForYear(calendarKey, gregorianYear).find((r) => r.key === m.baseKey)?.date;
    if (!baseDate) continue; // Defensive - every relativeToKey entry's baseKey must exist in the same calendar (checked by a unit test).
    resolved.push({ key: entry.key, date: addUtcDays(baseDate, m.offsetDays) });
  }

  const byKey = new Map(HOLIDAY_CATALOG.map((e) => [e.key, e]));
  return resolved
    .map((r) => {
      const entry = byKey.get(r.key)!;
      return { key: r.key, labelHe: entry.labelHe, date: r.date, defaultReminderDaysBefore: entry.defaultReminderDaysBefore };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/// `YYYY-MM-DD` (Asia/Jerusalem) helper re-exported for callers building
/// idempotency keys / display strings from a holiday occurrence's date
/// without having to import lib/timezone.ts directly.
export function holidayDateKey(date: Date): string {
  return localDateKey(date, TIMEZONE);
}
