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
// without a migration). Two calendars are seeded here:
//   - "il_holidays": the major Israeli/Jewish chagim and national
//     observance days that affect office availability and client
//     communication timing - computed via @hebcal/core (never
//     hand-rolled), matched by each event's stable English description
//     key (`.getDesc('s')`) rather than any hand-computed date math, so
//     leap years/Adar/moving festivals are always exactly right.
//   - "international_holidays": a small hard-coded set of fixed-Gregorian
//     dates relevant to clients with international ties. Kept
//     deliberately minimal (spec gives no explicit list) - Ariel can ask
//     for more to be added at any time; adding one is a one-line catalog
//     entry, never a migration (source-controlled, not a DB table).
//
// Matching rule per catalog entry (see the ambiguity note inline below):
// "exact" for same-named single-day holidays, "startsWithYear" only for
// Rosh Hashana, whose hebcal description embeds the Hebrew year (e.g.
// "Rosh Hashana 5787") and would otherwise collide with the unrelated
// "Rosh Hashana LaBehemot" (New Year for Animals, a very minor date in
// Elul, ~3 weeks earlier) and "Rosh Hashana II" (day 2) if matched by a
// naive prefix.

import "server-only";
import { HebrewCalendar } from "@hebcal/core";
import { localDateKey, TIMEZONE } from "@/lib/timezone";

type Matcher = { type: "exact"; value: string } | { type: "startsWithYearDigit"; value: string };

export interface HolidayCatalogEntry {
  /** Stable key - stored as ImportantDate.holidayKey and the join half of its @@unique([clientId, holidayKey]) dedupe constraint. Never renamed once shipped (would silently orphan existing client dates). */
  key: string;
  labelHe: string;
  calendarKey: "il_holidays" | "international_holidays";
  defaultReminderDaysBefore: number[];
  match:
    | Matcher
    | { type: "fixedGregorian"; month: number; day: number };
}

export const HOLIDAY_CATALOG: HolidayCatalogEntry[] = [
  // --- il_holidays (source: @hebcal/core, il:true) ---
  { key: "rosh_hashana", labelHe: "ראש השנה", calendarKey: "il_holidays", defaultReminderDaysBefore: [30, 7], match: { type: "startsWithYearDigit", value: "Rosh Hashana " } },
  { key: "yom_kippur", labelHe: "יום כיפור", calendarKey: "il_holidays", defaultReminderDaysBefore: [14, 3], match: { type: "exact", value: "Yom Kippur" } },
  { key: "sukkot", labelHe: "סוכות", calendarKey: "il_holidays", defaultReminderDaysBefore: [14, 3], match: { type: "exact", value: "Sukkot I" } },
  { key: "shmini_atzeret", labelHe: "שמיני עצרת ושמחת תורה", calendarKey: "il_holidays", defaultReminderDaysBefore: [7, 1], match: { type: "exact", value: "Shmini Atzeret" } },
  { key: "chanukah", labelHe: "חנוכה", calendarKey: "il_holidays", defaultReminderDaysBefore: [7, 1], match: { type: "exact", value: "Chanukah: 1 Candle" } },
  { key: "tu_bishvat", labelHe: "ט\"ו בשבט", calendarKey: "il_holidays", defaultReminderDaysBefore: [7], match: { type: "exact", value: "Tu BiShvat" } },
  { key: "purim", labelHe: "פורים", calendarKey: "il_holidays", defaultReminderDaysBefore: [7, 1], match: { type: "exact", value: "Purim" } },
  { key: "pesach", labelHe: "פסח", calendarKey: "il_holidays", defaultReminderDaysBefore: [21, 7], match: { type: "exact", value: "Pesach I" } },
  { key: "yom_hashoah", labelHe: "יום השואה", calendarKey: "il_holidays", defaultReminderDaysBefore: [7], match: { type: "exact", value: "Yom HaShoah" } },
  { key: "yom_hazikaron", labelHe: "יום הזיכרון", calendarKey: "il_holidays", defaultReminderDaysBefore: [7], match: { type: "exact", value: "Yom HaZikaron" } },
  { key: "yom_haatzmaut", labelHe: "יום העצמאות", calendarKey: "il_holidays", defaultReminderDaysBefore: [7, 1], match: { type: "exact", value: "Yom HaAtzma'ut" } },
  { key: "lag_baomer", labelHe: "ל\"ג בעומר", calendarKey: "il_holidays", defaultReminderDaysBefore: [7], match: { type: "exact", value: "Lag BaOmer" } },
  { key: "shavuot", labelHe: "שבועות", calendarKey: "il_holidays", defaultReminderDaysBefore: [14, 3], match: { type: "exact", value: "Shavuot" } },
  { key: "tisha_bav", labelHe: "תשעה באב", calendarKey: "il_holidays", defaultReminderDaysBefore: [7], match: { type: "exact", value: "Tish'a B'Av" } },

  // --- international_holidays (fixed Gregorian) ---
  { key: "new_year", labelHe: "ראש השנה האזרחית", calendarKey: "international_holidays", defaultReminderDaysBefore: [14, 3], match: { type: "fixedGregorian", month: 1, day: 1 } },
  { key: "christmas", labelHe: "חג המולד", calendarKey: "international_holidays", defaultReminderDaysBefore: [14, 3], match: { type: "fixedGregorian", month: 12, day: 25 } },
];

export const HOLIDAY_CALENDAR_LABELS: Record<string, string> = {
  il_holidays: "חגי ישראל ומועדי ישראל",
  international_holidays: "חגים בינלאומיים",
};

function matchesEvent(matcher: Matcher, desc: string): boolean {
  if (matcher.type === "exact") return desc === matcher.value;
  return desc.startsWith(matcher.value) && /^\d/.test(desc.slice(matcher.value.length));
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
    if (entry.calendarKey !== "il_holidays" || entry.match.type === "fixedGregorian") continue;
    const matches = byDesc.filter((e) => matchesEvent(entry.match as Matcher, e.desc));
    if (matches.length === 0) continue; // Defensive - every entry above was hand-verified against a live 2026 catalog dump before shipping.
    const earliest = matches.reduce((a, b) => (a.date.getTime() <= b.date.getTime() ? a : b));
    results.push({ key: entry.key, date: earliest.date });
  }
  return results;
}

/// Computes the fixed-Gregorian international_holidays entries for a
/// given year - trivial, but kept as its own function so
/// computeHolidayOccurrencesForYear (below) has one uniform shape to call
/// regardless of calendarKey.
export function computeInternationalHolidayOccurrencesForYear(gregorianYear: number): Array<{ key: string; date: Date }> {
  return HOLIDAY_CATALOG.filter((e) => e.calendarKey === "international_holidays" && e.match.type === "fixedGregorian").map((e) => {
    const m = e.match as { type: "fixedGregorian"; month: number; day: number };
    return { key: e.key, date: new Date(Date.UTC(gregorianYear, m.month - 1, m.day)) };
  });
}

/// Single entry point used by the daily job / subscription logic: all
/// occurrences for one calendar in one Gregorian year, with the catalog's
/// Hebrew label and default reminder offsets attached.
export function computeHolidayOccurrencesForYear(
  calendarKey: "il_holidays" | "international_holidays",
  gregorianYear: number
): Array<{ key: string; labelHe: string; date: Date; defaultReminderDaysBefore: number[] }> {
  const raw = calendarKey === "il_holidays" ? computeIsraeliHolidayOccurrencesForYear(gregorianYear) : computeInternationalHolidayOccurrencesForYear(gregorianYear);
  const byKey = new Map(HOLIDAY_CATALOG.map((e) => [e.key, e]));
  return raw
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
