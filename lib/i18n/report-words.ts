import { REPORT_TEXT, type ReportColumn, type ReportType } from "@/lib/app-domain/reports";
import { FORECAST_CELL_TEXT } from "@/lib/prepaid-format";
import { formatReportCell } from "@/lib/report-cell";
import type messages from "@/messages/he.json";
import type { Outgoing } from "./outgoing";

// ADR 0006: the names of the internal reports, their columns and the few
// words their rows carry, by key, so the reports screen and the files a
// person downloads from it say the same thing in the same language. The
// labels in lib/app-domain/reports.ts are the Hebrew these keys hold.

export const REPORT_TYPE_KEY = {
  total_client_hours: "totalClientHours",
  hours_by_employee: "hoursByEmployee",
  hours_by_client: "hoursByClient",
  hours_by_category: "hoursByCategory",
  employee_client_matrix: "employeeClientMatrix",
  manual_edits: "manualEdits",
  overage_at_risk: "overageAtRisk",
  active_timers: "activeTimers",
  capacity: "capacity",
} as const satisfies Record<ReportType, string>;

export type ReportColumnKey = keyof (typeof messages)["reports"]["columns"];

const COLUMN_KEYS: ReadonlySet<string> = new Set([
  "entryCount", "clientCount", "actualMinutes", "billableMinutes", "employee", "client", "usedMinutes",
  "remainingMinutes", "utilizationPct", "kind", "forecast", "category", "pctOfTotal", "date", "manual",
  "edited", "actor", "reason", "status", "thresholdUsed", "startedAt", "elapsedMinutes", "longRunning",
  "clientBreakdown",
] satisfies ReportColumnKey[]);

export function isReportColumnKey(key: string): key is ReportColumnKey {
  return COLUMN_KEYS.has(key);
}

export type ReportWordKey = "yes" | "no" | "package" | "cycle" | "overage" | "atRisk" | "depleted" | "insufficientData";

/// The words a row carries as values (REPORT_TEXT, forecastCell). Only
/// these columns hold them; names stay as written.
export const REPORT_WORD_COLUMNS: ReadonlySet<string> = new Set(["kind", "status", "manual", "edited", "longRunning", "forecast"]);
export const REPORT_WORD_KEY = new Map<string, ReportWordKey>([
  [REPORT_TEXT.yes, "yes"],
  [REPORT_TEXT.no, "no"],
  [REPORT_TEXT.package, "package"],
  [REPORT_TEXT.cycle, "cycle"],
  [REPORT_TEXT.overage, "overage"],
  [REPORT_TEXT.atRisk, "atRisk"],
  [FORECAST_CELL_TEXT.depleted, "depleted"],
  [FORECAST_CELL_TEXT.insufficientData, "insufficientData"],
]);

/// A report as the requester downloads it: its title, its headers and its
/// rows, in their language. `pdf` writes figures as the screen does (H:MM,
/// decimal hours, an overdrawn bank in words); otherwise the raw numbers
/// stay, for calculation (spec 21).
export function localizedReportTable(
  out: Outgoing,
  type: ReportType,
  columns: ReportColumn[],
  rows: Record<string, string | number>[],
  opts: { pdf?: boolean } = {}
): { title: string; headers: string[]; rows: (string | number)[][] } {
  const word = (col: ReportColumn, text: string) => {
    const key = REPORT_WORD_COLUMNS.has(col.key) ? REPORT_WORD_KEY.get(text) : undefined;
    return key ? out.root(`reports.values.${key}`) : text;
  };
  return {
    title: out.root(`reports.types.${REPORT_TYPE_KEY[type]}`),
    headers: columns.map((c) => (isReportColumnKey(c.key) ? out.root(`reports.columns.${c.key}`) : c.label)),
    rows: rows.map((row) =>
      columns.map((c) => {
        if (opts.pdf) {
          const cell = formatReportCell(row, c);
          if (cell.prefix) return `${out.root("reports.values.overage")} ${cell.figure}`;
          return cell.figure ? cell.text : word(c, cell.text);
        }
        const value = row[c.key] ?? "";
        return typeof value === "string" ? word(c, value) : value;
      })
    ),
  };
}
