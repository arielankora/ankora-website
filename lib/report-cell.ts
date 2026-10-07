// How one cell of an internal report reads, on screen and in the PDF.
// Pure, no project imports beyond the formatters, so it is unit-tested
// directly (tests/unit/report-cell.test.ts).
//
// October 2026, Ariel on the "שעות לפי לקוח" report: RIMED had used 30:21
// of a 30:00 bank, and the "נותר" cell read "21-:1-". Two bugs stacked:
// the H:MM math floored a negative number (-1 hour and -21 minutes for an
// overrun of 21 minutes), and the bidi algorithm then reordered the minus
// signs inside a right-to-left table. A reader should never have to decode
// a negative balance, so an overdrawn bank now says so in words.

import { bankFigures, formatClockMinutes, formatDecimalHours } from "@/lib/hours-format";

export type CellTone = "overdrawn" | undefined;

export type ReportCell = {
  text: string;
  /// The figure on its own (e.g. "0.35"), for wrapping in a left-to-right
  /// isolate. Empty for plain text cells.
  figure: string;
  /// A word placed before the figure, e.g. "חריגה".
  prefix: string;
  tone: CellTone;
};

export type ReportCellColumn = {
  key: string;
  type?: "text" | "minutes" | "bankHours" | "percent" | "number";
};

const OVERDRAWN = "חריגה";

function plain(value: string): ReportCell {
  return { text: value, figure: "", prefix: "", tone: undefined };
}

function figure(value: string, tone: CellTone = undefined, prefix = ""): ReportCell {
  return { text: prefix ? `${prefix} ${value}` : value, figure: value, prefix, tone };
}

export function formatReportCell(row: Record<string, string | number>, col: ReportCellColumn): ReportCell {
  const value = row[col.key];
  if (value === undefined || value === null || value === "") return plain("");
  if (typeof value !== "number") return plain(String(value));

  switch (col.type) {
    case "percent":
      return figure(`${value}%`, value > 100 ? "overdrawn" : undefined);
    case "minutes":
      return figure(formatClockMinutes(value));
    case "bankHours": {
      // "Remaining" is derived from the rounded total and used figures,
      // exactly as the Hour Banks screen does, so the two never disagree
      // by a hundredth.
      const total = row.totalMinutes;
      const shown =
        col.key === "remainingMinutes" && typeof total === "number"
          ? bankFigures(total, total - value).remaining
          : formatDecimalHours(value);
      if (shown.startsWith("-")) return figure(shown.slice(1), "overdrawn", OVERDRAWN);
      return figure(shown);
    }
    default:
      return figure(String(value));
  }
}
