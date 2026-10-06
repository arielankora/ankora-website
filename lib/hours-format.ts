// October 2026, Ariel on Gilad Komorov's bank: "סה"כ 15:00, נוצל 3:04,
// נותר 11:56. Why don't they add up to 15?" They did. 3:04 is three hours
// and four minutes, not 3.04 hours, and a number written like a clock time
// gets added like a decimal. Packages are bought, priced and invoiced in
// decimal hours ("135.8"), so the bank screen now shows them that way too.
//
// The database still keeps minutes. This file only decides how they read.
//
// Every figure is rounded to hundredths of an hour once, and "remaining" is
// derived from the two rounded figures rather than rounded on its own. Round
// the three independently and a bank can show 10.00 = 3.34 + 6.67, which is
// the exact confusion this change exists to remove.

/// Minutes to whole hundredths of an hour, rounded half away from zero so a
/// negative balance rounds the same way as a positive one.
export function minutesToHundredths(minutes: number): number {
  const sign = minutes < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(minutes) * 100) / 60);
}

/// Hundredths of an hour as "12.34" (or "-0.50"). Always two decimals, so a
/// column of figures lines up and 3.5 never sits beside 3.07.
export function formatHundredths(hundredths: number): string {
  const sign = hundredths < 0 ? "-" : "";
  const abs = Math.abs(hundredths);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/// Minutes as decimal hours, e.g. 184 -> "3.07".
export function formatDecimalHours(minutes: number): string {
  return formatHundredths(minutesToHundredths(minutes));
}

export type BankFigures = {
  total: string;
  consumed: string;
  remaining: string;
  overdrawn: boolean;
};

/// The three figures a bank is read by, guaranteed to add up as shown:
/// total = consumed + remaining, to the hundredth.
export function bankFigures(totalMinutes: number, consumedMinutes: number): BankFigures {
  const total = minutesToHundredths(totalMinutes);
  const consumed = minutesToHundredths(consumedMinutes);
  const remaining = total - consumed;
  return {
    total: formatHundredths(total),
    consumed: formatHundredths(consumed),
    remaining: formatHundredths(remaining),
    overdrawn: remaining < 0,
  };
}
