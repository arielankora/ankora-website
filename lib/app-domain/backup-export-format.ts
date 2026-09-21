import { localDateKey } from "@/lib/timezone";

// Phase 11 (nightly backup + data export to email, per Ariel's direct
// request - "את כל הדאטה אני רוצה שנשלח למייל שלי כקובץ אקסל מסודר כל
// יום בלילה, דאטה זה דיווחי שעות ברמת שורה, לקוחות וכו'"). Row-shaping
// only: no "server-only", no Prisma import (only lib/timezone, which is
// itself import-safe - see its own test file), so - like lib/csv.ts and
// lib/xlsx.ts - this file actually runs in a plain test sandbox (see
// tests/unit/backup-export-format.test.ts), unlike almost every other
// lib/app-domain/*.ts file, which imports lib/prisma and so cannot be
// exercised outside a real Vercel build/Preview.
//
// lib/app-domain/backup-export.ts is the Prisma-touching counterpart:
// it fetches the raw rows (scope: ALL clients regardless of status, per
// Ariel's explicit decision - not just ACTIVE ones) and calls the
// functions below to turn them into sheet rows / a JSON dump. Keeping
// that split means the one part worth unit-testing (exactly which
// columns end up in which order, how nulls render, Hebrew Yes/No labels)
// is actually tested, instead of only ever exercised by a full DB-backed
// integration test.

export interface ExportClientRow {
  name: string;
  legalName: string | null;
  status: string;
  timezone: string;
  createdAt: Date;
}

export interface ExportTimeEntryRow {
  startAt: Date;
  clientName: string;
  employeeName: string;
  categoryName: string;
  taskTitle: string | null;
  actualSeconds: number | null;
  billableSeconds: number | null;
  note: string | null;
  isManual: boolean;
  isEdited: boolean;
  /// Phase 12 (spec "אישור דיווח שעות חופף בין לקוחות שונים").
  isOverlapConfirmed: boolean;
}

export interface ExportTaskRow {
  title: string;
  clientName: string;
  status: string;
  categoryName: string | null;
  assigneeName: string | null;
  dueDate: Date | null;
  createdAt: Date;
}

export const CLIENTS_SHEET_NAME = "לקוחות";
export const CLIENTS_SHEET_HEADERS = ["שם לקוח", "שם משפטי", "סטטוס", "אזור זמן", "נוצר בתאריך"];

export const TIME_ENTRIES_SHEET_NAME = "דיווחי שעות";
export const TIME_ENTRIES_SHEET_HEADERS = [
  "תאריך",
  "לקוח",
  "עובד",
  "קטגוריה",
  "משימה",
  "דקות בפועל",
  "דקות לחיוב",
  "הערה",
  "ידני",
  "נערך",
  "חפיפה מאושרת",
];

export const TASKS_SHEET_NAME = "משימות";
export const TASKS_SHEET_HEADERS = ["כותרת", "לקוח", "סטטוס", "קטגוריה", "אחראי", "תאריך יעד", "נוצרה בתאריך"];

/// Israel-local calendar date, spec-consistent with every other
/// day-labeled export in this codebase (lib/timezone.ts's own doc
/// comment: never `toISOString().slice(0, 10)` for a human-facing date -
/// that showed the WRONG day for the ~2-3 hour window after UTC midnight
/// but before Israel midnight, a real bug already fixed once in
/// reports.ts/client-portal.ts/report-schedules.ts per docs/adr/0001's
/// Phase 8 addendum. Not repeating it here.
function dayLabel(d: Date): string {
  return localDateKey(d);
}

export function clientsToSheetRows(clients: ExportClientRow[]): (string | number)[][] {
  return clients.map((c) => [c.name, c.legalName ?? "", c.status, c.timezone, dayLabel(c.createdAt)]);
}

export function timeEntriesToSheetRows(entries: ExportTimeEntryRow[]): (string | number)[][] {
  return entries.map((e) => [
    dayLabel(e.startAt),
    e.clientName,
    e.employeeName,
    e.categoryName,
    e.taskTitle ?? "",
    Math.round((e.actualSeconds ?? 0) / 60),
    Math.round((e.billableSeconds ?? 0) / 60),
    e.note ?? "",
    e.isManual ? "כן" : "לא",
    e.isEdited ? "כן" : "לא",
    e.isOverlapConfirmed ? "כן" : "לא",
  ]);
}

export function tasksToSheetRows(tasks: ExportTaskRow[]): (string | number)[][] {
  return tasks.map((t) => [
    t.title,
    t.clientName,
    t.status,
    t.categoryName ?? "",
    t.assigneeName ?? "",
    t.dueDate ? dayLabel(t.dueDate) : "",
    dayLabel(t.createdAt),
  ]);
}

/// One-line, RTL-safe summary used both in the nightly email body and in
/// the audit log - "N לקוחות, M דיווחי שעות, K משימות" never mixes a
/// number/Latin term at a sentence boundary, so it reads correctly
/// regardless of the bidi issue the rest of this project's Hebrew
/// documents had to work around (see the "תוכנית גיבוי" Claude Doc).
export function summaryLine(counts: { clients: number; timeEntries: number; tasks: number }): string {
  return `${counts.clients} לקוחות, ${counts.timeEntries} דיווחי שעות, ${counts.tasks} משימות`;
}
