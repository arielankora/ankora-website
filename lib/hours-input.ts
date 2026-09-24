// Hadas and Ariel, September 2026: Grantor's cycle was opened with 111 in a
// field that meant minutes, so the bank read 1:51 and needed two manual
// adjustments to reach 111 hours. Nobody thinks about a package in minutes.
//
// The hour-bank forms now take hours, written the way people write them:
//   "111"     111 hours
//   "7.5"     seven and a half hours
//   "98:04"   98 hours and 4 minutes
//   "-1:30"   minus an hour and a half (adjustments only)
// The database keeps minutes, exactly as before. Only the forms changed.

const HOURS_MINUTES = /^(-)?(\d+):([0-5]\d)$/;
const DECIMAL_HOURS = /^(-)?(\d+(?:\.\d+)?)$/;

/// Minutes, or null when the text is not a readable amount of hours.
export function parseHoursInput(raw: unknown, opts: { allowNegative?: boolean } = {}): number | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(",", ".");
  if (!text) return null;

  let minutes: number | null = null;
  let negative = false;
  const hm = HOURS_MINUTES.exec(text);
  if (hm) {
    negative = !!hm[1];
    minutes = Number(hm[2]) * 60 + Number(hm[3]);
  } else {
    const dec = DECIMAL_HOURS.exec(text);
    if (dec) {
      negative = !!dec[1];
      minutes = Math.round(Number(dec[2]) * 60);
    }
  }
  if (minutes === null) return null;
  if (negative && !opts.allowNegative) return null;
  return negative ? -minutes : minutes;
}
