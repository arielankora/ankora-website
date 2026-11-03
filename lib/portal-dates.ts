// Client portal, 3.11.2026 (Hadas's review of the client screen): one way to
// write a date on every portal screen. Before this the headings said
// "1 בנוב׳ 2026", the promise rows "1 בנוב׳" and the tables "2026-11-01",
// three spellings of the same day on one visit.
//
// The one form is day, short month name, and the year only when it is not
// the current year: "1 בנוב׳", or "28 בדצמ׳ 2025". Always in Israel's
// calendar, because that is the calendar the client and the reports use.

const TZ = "Asia/Jerusalem";

function israelYear(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric" }).format(date);
}

/// A calendar-day key ("2026-11-01", the form the portal's rows carry) to an
/// instant inside that day in Israel. Noon UTC is the same calendar day in
/// Israel all year round (UTC+2 or +3), so the formatter cannot drift a day.
function fromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/// A date as every portal screen writes it. Accepts a Date or a "YYYY-MM-DD"
/// day key. `now` is for tests.
export function formatPortalDate(value: Date | string, now: Date = new Date()): string {
  const date = typeof value === "string" ? fromDayKey(value) : value;
  const withYear = israelYear(date) !== israelYear(now);
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: TZ,
  }).format(date);
}

/// A period whose end is exclusive (a week or a month as the domain returns
/// it): the last day shown is the day before `toExclusive`.
export function formatPortalRange(from: Date, toExclusive: Date, now: Date = new Date()): string {
  // Twelve hours back, not 24: on a day the clock changes, 24 hours back
  // from midnight can land on the evening of the day before.
  const last = new Date(toExclusive.getTime() - 12 * 3_600_000);
  return `${formatPortalDate(from, now)} עד ${formatPortalDate(last, now)}`;
}
