import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { toXlsx } from "@/lib/xlsx";

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec 14.4's "מומלץ"
// XLSX/PDF export). Unlike almost every lib/app-domain/*.ts test in this
// suite, lib/xlsx.ts imports neither Prisma nor anything that does - only
// exceljs - so this test actually RUNS in this sandbox (no
// binaries.prisma.sh reachability needed), verified by round-tripping the
// real buffer back through exceljs's own reader rather than just checking
// byte length.
describe("toXlsx()", () => {
  it("produces a real, readable .xlsx buffer with a PK zip signature", async () => {
    const buf = await toXlsx("Test", ["A", "B"], [["x", 1]]);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });

  it("round-trips headers and rows through exceljs", async () => {
    const buf = await toXlsx("שעות לפי לקוח", ["לקוח", "דקות"], [
      ["חברה בעמ", 120],
      ["Global Tech", 45],
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    const sheet = workbook.worksheets[0];

    expect(sheet.getRow(1).getCell(1).value).toBe("לקוח");
    expect(sheet.getRow(1).getCell(2).value).toBe("דקות");
    expect(sheet.getRow(2).getCell(1).value).toBe("חברה בעמ");
    expect(sheet.getRow(2).getCell(2).value).toBe(120);
    expect(sheet.getRow(3).getCell(1).value).toBe("Global Tech");
  });

  it("sets rightToLeft on the sheet view for Hebrew reports", async () => {
    const buf = await toXlsx("Test", ["A"], [["x"]]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    expect(workbook.worksheets[0].views[0]?.rightToLeft).toBe(true);
  });

  it("bolds the header row", async () => {
    const buf = await toXlsx("Test", ["A"], [["x"]]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    expect(workbook.worksheets[0].getRow(1).font?.bold).toBe(true);
  });

  it("truncates a sheet name longer than Excel's 31-character limit", async () => {
    const longName = "a".repeat(50);
    const buf = await toXlsx(longName, ["A"], [["x"]]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    expect(workbook.worksheets[0].name.length).toBeLessThanOrEqual(31);
  });
});
