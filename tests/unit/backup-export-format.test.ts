import { describe, expect, it } from "vitest";
import {
  clientsToSheetRows,
  timeEntriesToSheetRows,
  tasksToSheetRows,
  summaryLine,
} from "@/lib/app-domain/backup-export-format";

// Phase 11 (nightly backup + data export to email). Like
// tests/unit/csv.test.ts and tests/unit/xlsx.test.ts, this file imports
// only pure, non-Prisma modules (backup-export-format.ts + lib/timezone.ts)
// so it actually runs in this sandbox - see backup-export-format.ts's own
// header comment for why the Prisma-touching row-fetching lives in a
// separate file (lib/app-domain/backup-export.ts) instead.

describe("clientsToSheetRows()", () => {
  it("maps every field, falling back to an empty string for a null legal name", () => {
    const rows = clientsToSheetRows([
      { name: "חברה בעמ", legalName: null, status: "ACTIVE", timezone: "Asia/Jerusalem", createdAt: new Date("2026-01-05T10:00:00Z") },
    ]);
    expect(rows).toEqual([["חברה בעמ", "", "ACTIVE", "Asia/Jerusalem", "2026-01-05"]]);
  });

  it("includes clients of every status, not only ACTIVE (Ariel's explicit scope decision)", () => {
    const rows = clientsToSheetRows([
      { name: "A", legalName: "A ltd", status: "ACTIVE", timezone: "Asia/Jerusalem", createdAt: new Date() },
      { name: "B", legalName: null, status: "INACTIVE", timezone: "Asia/Jerusalem", createdAt: new Date() },
    ]);
    expect(rows.map((r) => r[2])).toEqual(["ACTIVE", "INACTIVE"]);
  });
});

describe("timeEntriesToSheetRows()", () => {
  it("converts seconds to rounded minutes and labels the LOCAL (Israel) day, not the UTC day", () => {
    // 2025-12-31T22:30:00Z is 2026-01-01 00:30 in Israel (winter, +2) -
    // same regression this codebase already fixed once elsewhere
    // (lib/timezone.ts / docs/adr/0001 Phase 8 addendum).
    const rows = timeEntriesToSheetRows([
      {
        startAt: new Date("2025-12-31T22:30:00Z"),
        clientName: "לקוח",
        employeeName: "נועה",
        categoryName: "פיתוח",
        taskTitle: "משימה א",
        actualSeconds: 5400,
        billableSeconds: 5390,
        note: null,
        isManual: false,
        isEdited: true,
        isOverlapConfirmed: true,
      },
    ]);
    expect(rows).toEqual([["2026-01-01", "לקוח", "נועה", "פיתוח", "משימה א", 90, 90, "", "לא", "כן", "כן"]]);
  });

  it("treats a still-running timer (null actual/billable seconds) as zero minutes, not NaN or a crash", () => {
    const rows = timeEntriesToSheetRows([
      {
        startAt: new Date(),
        clientName: "לקוח",
        employeeName: "עובד",
        categoryName: "כללי",
        taskTitle: null,
        actualSeconds: null,
        billableSeconds: null,
        note: "הערה",
        isManual: true,
        isEdited: false,
        isOverlapConfirmed: false,
      },
    ]);
    expect(rows[0].slice(5, 7)).toEqual([0, 0]);
    expect(rows[0][4]).toBe(""); // no task title
    expect(rows[0][10]).toBe("לא"); // isOverlapConfirmed
  });
});

describe("tasksToSheetRows()", () => {
  it("renders a missing due date / category / assignee as empty strings", () => {
    const rows = tasksToSheetRows([
      {
        title: "משימה",
        clientName: "לקוח",
        status: "OPEN",
        categoryName: null,
        assigneeName: null,
        dueDate: null,
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
    ]);
    expect(rows).toEqual([["משימה", "לקוח", "OPEN", "", "", "", "2026-03-01"]]);
  });

  it("labels a set due date using the local calendar day", () => {
    const rows = tasksToSheetRows([
      {
        title: "משימה",
        clientName: "לקוח",
        status: "OPEN",
        categoryName: "כללי",
        assigneeName: "עובד",
        dueDate: new Date("2026-08-31T21:30:00Z"), // 2026-09-01 in Israel (summer, +3)
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
    ]);
    expect(rows[0][5]).toBe("2026-09-01");
  });
});

describe("summaryLine()", () => {
  it("formats counts as a single flowing Hebrew sentence fragment", () => {
    expect(summaryLine({ clients: 12, timeEntries: 340, tasks: 58 })).toBe("12 לקוחות, 340 דיווחי שעות, 58 משימות");
  });
});
