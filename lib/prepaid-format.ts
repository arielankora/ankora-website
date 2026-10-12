import type { PrepaidForecast } from "@/lib/app-domain/hour-banks";
import { formatDecimalHours } from "@/lib/hours-format";

// Words for a prepaid package's forecast (12.10.2026). One place, so the
// Hour Banks screen, the portal, the reports and MCP say the same thing.

function formatDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone }).format(date);
}

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
export function forecastCell(forecast: PrepaidForecast | null, timeZone = "Asia/Jerusalem"): string {
  if (!forecast) return "";
  switch (forecast.status) {
    case "depleted":
      return "נוצלה";
    case "insufficient_data":
      return "אין מספיק נתונים";
    case "projected":
      return formatDay(forecast.depletionDate, timeZone);
  }
}
