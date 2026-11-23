// Agents (23.11.2026, "סוכנים באנקורה: אפיון"): "עדכונים ממתינים נערמים
// בלי אישור: אחרי 7 ימים הפריט עולה בתדריך הבוקר ומופיע למנהל."
//
// An update waits from the day the first version this installation has
// not taken was approved. A newer version on top of it does not restart
// the clock: the pile is what is worth a line.

export const PENDING_UPDATE_DAYS = 7;

export function isPendingUpdateStale(waitingSince: Date | null, now: Date): boolean {
  if (!waitingSince) return false;
  return now.getTime() - waitingSince.getTime() >= PENDING_UPDATE_DAYS * 24 * 3600_000;
}
