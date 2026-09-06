import "server-only";
import ExcelJS from "exceljs";

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

export async function toXlsx(sheetName: string, headers: string[], rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || "Sheet1", {
    views: [{ rightToLeft: true }],
  });

  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);

  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 60);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
