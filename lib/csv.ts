// Pure CSV helpers - no "server-only" and no other project imports, so
// this module (unlike almost everything else in lib/app-domain/) can be
// unit-tested in any sandbox regardless of database/network reachability.
// Used by app/api/reports/export/route.ts (spec 14.4: "CSV חובה").

/// Minimal RFC 4180 field escaping - quotes a field only when it contains
/// a comma, quote, or newline, doubling any embedded quotes.
export function csvField(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/// Builds a full CSV document (header row + data rows) with a leading
/// UTF-8 BOM so Hebrew text opens correctly in Excel - spec 14.4's
/// explicit requirement ("עברית חייבת להישאר קריאה, כולל UTF-8 BOM
/// ב-CSV אם נדרש ל-Excel"). Uses CRLF line endings per RFC 4180.
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(csvField).join(","), ...rows.map((row) => row.map(csvField).join(","))];
  return "﻿" + lines.join("\r\n");
}
