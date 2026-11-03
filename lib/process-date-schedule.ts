// The schedule of a date added from a process card (lib/app-domain/
// process-dates.ts), read from its short form. Pure.

export type ProcessDateSchedule = {
  recurrence: "BUSINESS_DAILY" | "WEEKLY" | "MONTHLY" | "ONCE";
  month: number;
  day: number;
  weekday: number | null;
  onceDate: Date | null;
};

/// The form's fields as a schedule, or the reason they are not one.
export function readProcessDateSchedule(f: { recurrence: string; weekday?: string; dayOfMonth?: string; onceDate?: string }): ProcessDateSchedule | { error: string } {
  switch (f.recurrence) {
    case "BUSINESS_DAILY":
      // month/day are NOT NULL and ignored for a daily date.
      return { recurrence: "BUSINESS_DAILY", month: 1, day: 1, weekday: null, onceDate: null };
    case "WEEKLY": {
      const weekday = Number(f.weekday);
      if (f.weekday === undefined || f.weekday === "" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: "צריך לבחור יום בשבוע." };
      return { recurrence: "WEEKLY", month: 1, day: 1, weekday, onceDate: null };
    }
    case "MONTHLY": {
      const day = Number(f.dayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) return { error: "צריך יום בחודש, בין 1 ל-31." };
      return { recurrence: "MONTHLY", month: 1, day, weekday: null, onceDate: null };
    }
    case "ONCE": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.onceDate ?? "")) return { error: "צריך תאריך." };
      const [y, m, d] = f.onceDate!.split("-").map(Number);
      return { recurrence: "ONCE", month: m, day: d, weekday: null, onceDate: new Date(`${f.onceDate}T00:00:00Z`) };
    }
    default:
      return { error: "צריך לבחור כל כמה זמן." };
  }
}
