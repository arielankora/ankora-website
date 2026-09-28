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
