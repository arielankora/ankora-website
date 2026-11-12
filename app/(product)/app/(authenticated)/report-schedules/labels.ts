// ADR 0006: the screen's keys for a scheduled report's type and weekday
// (reportSchedules.types.* and reportSchedules.weekdays.*). The email the
// schedule sends keeps its own Hebrew labels in
// lib/app-domain/report-schedules.ts.
export const REPORT_TYPE_KEY = {
  MONTHLY_DETAILED: "monthlyDetailed",
  WEEKLY_ACTIVITY: "weeklyActivity",
  HOURS_BY_CATEGORY: "hoursByCategory",
  HOUR_BANK_STATUS: "hourBankStatus",
} as const;

/// Sunday first, matching ReportSchedule.dayOfWeek (0 = Sunday).
export const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
