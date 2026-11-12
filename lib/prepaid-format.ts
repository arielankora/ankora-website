import type { PrepaidForecast } from "@/lib/app-domain/hour-banks";
import { formatDecimalHours } from "@/lib/hours-format";

// Words for a prepaid package's forecast (12.10.2026). One place, so the
// Hour Banks screen, the portal, the reports and MCP say the same thing.

function formatDay(date: Date, timeZone: string, locale = "he-IL"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(date);
}

/// The two words forecastCell can return besides a date. Exported so a
/// screen in another language can recognise them (reports/page.tsx).
export const FORECAST_CELL_TEXT = { depleted: "נוצלה", insufficientData: "אין מספיק נתונים" } as const;

/// A sentence: "בקצב של 7.50 שעות בשבוע, היתרה צפויה להספיק עד 2 בנוב׳ 2026."
export function describeForecast(forecast: PrepaidForecast | null, timeZone = "Asia/Jerusalem"): string | null {
  if (!forecast) return null;
  switch (forecast.status) {
    case "depleted":
      return "החבילה נוצלה. שעות נוספות יקוזזו מהטעינה הבאה.";
    case "insufficient_data":
      return "אין עדיין מספיק דיווחים מ-4 השבועות האחרונים כדי לצפות מתי היתרה תיגמר.";
    case "projected":
      return `בקצב של ${formatDecimalHours(forecast.weeklyMinutes)} שעות בשבוע, היתרה צפויה להספיק עד ${formatDay(
        forecast.depletionDate,
        timeZone
      )}.`;
  }
}

/// A cell: a date, "נוצלה", or "אין מספיק נתונים". Empty for a cycle.
/// `locale` only changes how the date is written (ADR 0006: the reports
/// screen passes the reader's; exports and the portal keep he-IL).
export function forecastCell(forecast: PrepaidForecast | null, timeZone = "Asia/Jerusalem", locale = "he-IL"): string {
  if (!forecast) return "";
  switch (forecast.status) {
    case "depleted":
      return FORECAST_CELL_TEXT.depleted;
    case "insufficient_data":
      return FORECAST_CELL_TEXT.insufficientData;
    case "projected":
      return formatDay(forecast.depletionDate, timeZone, locale);
  }
}
