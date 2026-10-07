import { localDateKey } from "@/lib/timezone";

/// The portal's "previous / next period" screens move by an offset taken
/// straight out of the query string: `?monthOffset=-1`, `?weekOffset=2`.
///
/// `Number(raw || 0)` returns NaN for anything that is not a number, and
/// `date.setUTCMonth(NaN)` turns the date into an Invalid Date rather than
/// throwing. Nothing downstream notices: the value is passed to Prisma as
/// a range bound, and to Intl.DateTimeFormat for the screen's title, where
/// it finally fails with `RangeError: Invalid time value` - a 500 on a
/// client-facing screen, produced by a URL the client can simply type or
/// be sent. An absurd-but-numeric offset (`1e400`, `99999999`) lands in
/// the same place, because the resulting instant is outside the range a
/// JS Date can represent.
///
/// So the offset is parsed once, here, and a value that is not a finite
/// whole number inside the allowed window is treated as "no offset"
/// rather than carried forward as a broken date. `maxAbs` is generous on
/// purpose - it only has to be small enough that the arithmetic stays
/// inside Date's range, not small enough to second-guess the screen.
export function parsePeriodOffset(raw: string | null | undefined, maxAbs: number): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return 0;
  const whole = Math.trunc(n);
  if (whole > maxAbs || whole < -maxAbs) return 0;
  return whole;
}

/// ~100 years either side. Beyond this a month offset is not a screen
/// anyone asked for, and the Date arithmetic stops being representable.
export const MAX_MONTH_OFFSET = 1200;

/// ~100 years either side, in weeks.
export const MAX_WEEK_OFFSET = 5200;

/// The month a portal screen should show, `monthOffset` Israeli months away
/// from `now`.
///
/// 7.10.2026. Every caller used to do
///
///     const d = new Date(); d.setUTCMonth(d.getUTCMonth() + monthOffset);
///
/// which keeps today's day-of-month. On the 29th to the 31st the target
/// month overflows: 31 October minus one month is "31 September", which
/// JavaScript rolls forward to 1 October. A client who pressed "previous
/// month", or the download link on the history screen, got the current
/// month's hours under last month's name. It also counted months in UTC,
/// so for the first hours of each Israeli month it was one month behind.
///
/// The month is now chosen in Israel time and the reference instant is the
/// 15th at noon UTC, which is inside that Israeli month whatever the DST
/// offset. `year` and `month` (1-12) are returned for titles and filenames
/// so they cannot disagree with the data.
export function israelMonthReference(
  monthOffset: number,
  now: Date = new Date(),
): { referenceDate: Date; year: number; month: number } {
  const [y, m] = localDateKey(now).split("-").map(Number);
  const index = y * 12 + (m - 1) + monthOffset;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { referenceDate: new Date(Date.UTC(year, month - 1, 15, 12)), year, month };
}

/// The inverse: how many Israeli months `date` is from `now`. Used by the
/// history screen to link a sent monthly report to its month. A report
/// period starts at Israeli midnight on the 1st, which is still the last
/// day of the previous month in UTC, so counting UTC months here pointed
/// every link one month too early.
export function israelMonthOffset(date: Date, now: Date = new Date()): number {
  const [y1, m1] = localDateKey(date).split("-").map(Number);
  const [y0, m0] = localDateKey(now).split("-").map(Number);
  return (y1 - y0) * 12 + (m1 - m0);
}
