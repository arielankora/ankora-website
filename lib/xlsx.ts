import "server-only";
import ExcelJS from "exceljs";
import { neutralizeFormula } from "@/lib/csv";

// Spec 14.4: "XLSX מומלץ" (recommended). Added in the Phase 9 gap-fix pass
// (docs/adr/0001 section 17) alongside PDF - CSV (lib/csv.ts) already
// satisfied 14.4's one mandatory requirement; this fills in the two
// recommended formats using the same (headers, rows) shape every export
// route already builds for CSV, so no report/domain code needed to change.
//
// exceljs (not the `xlsx`/SheetJS package) - actively maintained, writes
// real .xlsx (not the older .xls binary format), and RTL/Hebrew text needs
// no special handling since XLSX cells are plain UTF-16 strings (unlike
// CSV, which needs the UTF-8 BOM workaround in lib/csv.ts for Excel).

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: (string | number)[][];
}

// Phase 11 addition (nightly backup + data export to email, per Ariel's
// direct request): the nightly export needs several sheets in ONE
// workbook (clients / time entries / tasks) rather than toXlsx()'s
// single-sheet shape. toXlsx() itself is now just the one-sheet case of
// this, kept byte-for-byte behavior-compatible (same signature, same
// 31-char sheet-name truncation, same bold header row, same
// autofit-ish column width) so every existing caller is unaffected.
export async function toXlsxWorkbook(sheets: XlsxSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const { name, headers, rows } of sheets) {
    const sheet = workbook.addWorksheet(name.slice(0, 31) || "Sheet1", {
      views: [{ rightToLeft: true }],
    });

    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    // Security review (OWASP A03:2021 - Injection; CWE-1236): XLSX cells
    // are evaluated as formulas by Excel exactly like CSV cells are, and
    // these rows carry the same user-typed free text (client names, task
    // titles, entry notes). Reuses lib/csv.ts's neutralizeFormula so the
    // two export formats cannot drift apart - see that function's comment
    // for the full reasoning and the DDE/HYPERLINK payloads it blocks.
    for (const row of rows) sheet.addRow(row.map(neutralizeFormula));

    sheet.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = String(cell.value ?? "").length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 60);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function toXlsx(sheetName: string, headers: string[], rows: (string | number)[][]): Promise<Buffer> {
  return toXlsxWorkbook([{ name: sheetName, headers, rows }]);
}
