import "server-only";
import { gzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { toXlsxWorkbook } from "@/lib/xlsx";
import { recordAudit } from "@/lib/app-auth/audit";
import { localDateKey } from "@/lib/timezone";
import { uploadFileToDriveFolder, DRIVE_FOLDER_EXCEL_REPORTS, DRIVE_FOLDER_DB_DUMPS } from "@/lib/google-drive";
import {
  CLIENTS_SHEET_NAME,
  CLIENTS_SHEET_HEADERS,
  TIME_ENTRIES_SHEET_NAME,
  TIME_ENTRIES_SHEET_HEADERS,
  TASKS_SHEET_NAME,
  TASKS_SHEET_HEADERS,
  clientsToSheetRows,
  timeEntriesToSheetRows,
  tasksToSheetRows,
  summaryLine,
} from "@/lib/app-domain/backup-export-format";

// Phase 11: nightly backup + data export to email, per Ariel's direct
// request (see this project's Claude Doc "תוכנית גיבוי, שמירה ושחזור -
// ankora.co.il" for the full plan this implements, and docs/adr/0001's
// Phase 11 addendum for the implementation notes). Two deliverables,
// both attached to the same nightly email AND uploaded directly to their
// own Google Drive folder from this same function (see
// lib/google-drive.ts's doc comment for why the Drive upload moved here
// from a separate Claude-side Gmail-relay task - short version: that
// relay broke twice on the exact base64-encoding step, a structural
// sandbox limitation, not a fixable bug, so this app now uploads both
// files itself instead of depending on an external relay each night):
//
//  1. An Excel workbook (clients / time entries / tasks) - the
//     human-readable nightly report Ariel asked for directly ("את כל
//     הדאטה... כל יום בלילה, דיווחי שעות ברמת שורה, לקוחות וכו'").
//  2. A gzipped JSON dump of the same core business tables (plus Users
//     and Categories, needed as lookup context, and HourBanks) - the
//     supplementary, coarse-grained backup this project's own automated
//     Neon PITR (point-in-time recovery) doesn't cover once its
//     retention window passes. This is NOT a full schema-for-schema
//     database dump - append-only/audit-style tables (AuditEvent,
//     TimeEntryRevision, EmailDelivery, etc.) are intentionally left
//     out: Neon PITR is the authoritative full-fidelity backup within
//     its retention window, this dump is the secondary safety net for
//     the core OPERATIONAL entities specifically, scoped to what a
//     human would actually need to reconstruct "who is owed what" if
//     the database were lost outright. Extend the `dumpCoreTables()`
//     model list below if that scope ever needs to grow.
//
// The email stays (Ariel reads it directly, and it's a second, fully
// independent delivery path - if Drive's service-account credentials
// ever expire/break, the data still reaches him). Drive upload failure
// and email failure are reported and logged independently, and neither
// blocks the other (Promise.all, not a chain) - matches this function's
// existing "never throw, always report" contract.
//
// Security note: User rows are dumped WITHOUT passwordHash (even though
// it's an irreversible bcrypt hash, not a plaintext secret) - this dump
// travels over email and into Google Drive, both outside this project's
// database access boundary, so the blast radius of a leaked backup is
// deliberately kept smaller. A restore from this dump means every user
// resets their password via the existing forgot-password flow
// (lib/app-domain/auth.ts's PasswordResetToken flow already exists for
// exactly this) rather than regaining their old password - an
// acceptable, already-supported tradeoff, not a gap.
//
// Scope of "which clients": ALL clients regardless of status (ACTIVE,
// PAUSED, ARCHIVED) - Ariel's explicit decision when asked, not just
// active ones. Soft-deleted rows (deletedAt != null) are excluded from
// BOTH the Excel report and the JSON dump: for the Excel report this
// matches every other report in this codebase (buildSnapshot in
// report-schedules.ts, etc. all filter deletedAt: null); for the JSON
// dump, a soft-deleted row is (by this app's own model) meant to behave
// as gone, and Neon PITR - not this dump - is the correct recovery path
// for "undo an accidental delete."

const RECIPIENTS = ["ariel@ankora.co.il", "hadas@ankora.co.il"];

interface NightlyExportResult {
  ok: boolean;
  counts: { clients: number; timeEntries: number; tasks: number };
  error?: string;
  drive?: {
    excel: { ok: boolean; fileId?: string; error?: string };
    dbDump: { ok: boolean; fileId?: string; error?: string };
  };
}

async function fetchClientsSheetData() {
  const clients = await prisma.client.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });
  return clients.map((c) => ({
    name: c.name,
    legalName: c.legalName,
    status: c.status,
    timezone: c.timezone,
    createdAt: c.createdAt,
  }));
}

async function fetchTimeEntriesSheetData() {
  const entries = await prisma.timeEntry.findMany({
    where: { deletedAt: null, endAt: { not: null } },
    include: { client: true, user: true, category: true, task: true },
    orderBy: { startAt: "asc" },
  });
  return entries.map((e) => ({
    startAt: e.startAt,
    clientName: e.client.name,
    employeeName: e.user.name,
    categoryName: e.category.name,
    taskTitle: e.task?.title ?? null,
    actualSeconds: e.actualSeconds,
    billableSeconds: e.billableSeconds,
    note: e.note,
    isManual: e.isManual,
    isEdited: e.isEdited,
    isOverlapConfirmed: e.isOverlapConfirmed,
  }));
}

async function fetchTasksSheetData() {
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null },
    include: { client: true, category: true, assignedTo: true },
    orderBy: { createdAt: "asc" },
  });
  return tasks.map((t) => ({
    title: t.title,
    clientName: t.client.name,
    status: t.status,
    categoryName: t.category?.name ?? null,
    assigneeName: t.assignedTo?.name ?? null,
    dueDate: t.dueDate,
    createdAt: t.createdAt,
  }));
}

/// The secondary, coarse-grained JSON backup described in this file's
/// header comment - core operational tables only, Users without
/// passwordHash. Every array here is scoped to `deletedAt: null` (where
/// the model has that column) for the same "soft-deleted = Neon PITR's
/// job, not this dump's" reasoning above.
async function dumpCoreTables() {
  const [clients, users, categories, tasks, timeEntries, hourBanks] = await Promise.all([
    prisma.client.findMany({ where: { deletedAt: null } }),
    prisma.user.findMany({ where: { deletedAt: null } }),
    prisma.category.findMany({ where: { deletedAt: null } }),
    prisma.task.findMany({ where: { deletedAt: null } }),
    prisma.timeEntry.findMany({ where: { deletedAt: null } }),
    prisma.hourBank.findMany({ where: { deletedAt: null } }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    scope: "core operational tables only - see backup-export.ts header comment",
    clients,
    users: users.map(({ passwordHash, ...rest }) => rest),
    categories,
    tasks,
    timeEntries,
    hourBanks,
  };
}

/// Builds both attachments and sends the one nightly email to
/// ariel@ankora.co.il + hadas@ankora.co.il. Called from the daily cron
/// (app/api/cron/scheduled-reports/route.ts, alongside
/// reconcileScheduledReports() - see that route's own comment for why
/// this project's Vercel Hobby plan means a new job gets folded into an
/// existing cron rather than a third one). Never throws - matches every
/// other cron-called domain function's contract (alerts.ts,
/// notifications.ts, report-schedules.ts) so one failing job never
/// prevents the route from returning a clean result for the others.
export async function sendNightlyDataExport(now: Date = new Date()): Promise<NightlyExportResult> {
  try {
    const [clientRows, timeEntryRows, taskRows] = await Promise.all([
      fetchClientsSheetData(),
      fetchTimeEntriesSheetData(),
      fetchTasksSheetData(),
    ]);

    const counts = { clients: clientRows.length, timeEntries: timeEntryRows.length, tasks: taskRows.length };

    const excelBuffer = await toXlsxWorkbook([
      { name: CLIENTS_SHEET_NAME, headers: CLIENTS_SHEET_HEADERS, rows: clientsToSheetRows(clientRows) },
      { name: TIME_ENTRIES_SHEET_NAME, headers: TIME_ENTRIES_SHEET_HEADERS, rows: timeEntriesToSheetRows(timeEntryRows) },
      { name: TASKS_SHEET_NAME, headers: TASKS_SHEET_HEADERS, rows: tasksToSheetRows(taskRows) },
    ]);

    const dump = await dumpCoreTables();
    const dumpGz = gzipSync(Buffer.from(JSON.stringify(dump)));

    const dateLabel = localDateKey(now);
    const summary = summaryLine(counts);

    const excelFilename = `ankora-נתונים-${dateLabel}.xlsx`;
    const dumpFilename = `ankora-database-dump-${dateLabel}.json.gz`;

    // Three independent outbound calls (email + two Drive uploads) -
    // Promise.all, not a chain, so one failing does not block or delay
    // the others, and each is reported separately below.
    const [result, driveExcel, driveDump] = await Promise.all([
      sendEmail({
        to: RECIPIENTS,
        subject: `Ankora - דוח נתונים וגיבוי יומי - ${dateLabel}`,
        text: [
          `מצורפים דוח הנתונים היומי וגיבוי מסד הנתונים של אנקורה, נכון להלילה.`,
          ``,
          `הדוח כולל ${summary}.`,
          ``,
          `שני קבצים מצורפים: אקסל מסודר לקריאה, וקובץ גיבוי דחוס (JSON) שמיועד לארכוב בלבד ולא לקריאה ישירה.`,
        ].join("\n"),
        attachments: [
          { filename: excelFilename, content: excelBuffer },
          {
            filename: dumpFilename,
            content: dumpGz,
            contentType: "application/gzip",
          },
        ],
      }),
      uploadFileToDriveFolder({
        name: excelFilename,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content: excelBuffer,
        folderId: DRIVE_FOLDER_EXCEL_REPORTS,
      }),
      uploadFileToDriveFolder({
        name: dumpFilename,
        mimeType: "application/gzip",
        content: dumpGz,
        folderId: DRIVE_FOLDER_DB_DUMPS,
      }),
    ]);

    if (!driveExcel.ok) console.error("Drive upload (Excel report) failed:", driveExcel.error);
    if (!driveDump.ok) console.error("Drive upload (DB dump) failed:", driveDump.error);

    await prisma.emailDelivery.create({
      data: {
        // Neither an alert nor a per-client ReportRun (this is a whole-
        // system nightly export, not scoped to one schedule/client) -
        // both FKs intentionally null here, a deliberate exception to
        // EmailDelivery's own doc comment ("exactly one of
        // alertEventId/reportRunId set in practice"), documented at that
        // exception's source.
        template: "backup.nightly_export",
        recipients: RECIPIENTS,
        status: result.ok ? "SENT" : "FAILED",
        providerMessageId: result.providerMessageId,
        error: result.error,
      },
    });

    await recordAudit({
      actorId: null,
      action: "backup.nightly_export.sent",
      entityType: "System",
      after: {
        ok: result.ok,
        counts,
        drive: { excel: driveExcel.ok, dbDump: driveDump.ok },
      },
    });

    return {
      ok: result.ok,
      counts,
      error: result.error,
      drive: { excel: driveExcel, dbDump: driveDump },
    };
  } catch (err: any) {
    // Never throw - see doc comment above. Logged (Vercel's runtime
    // logs) rather than silently swallowed.
    console.error("sendNightlyDataExport failed:", err);
    return { ok: false, counts: { clients: 0, timeEntries: 0, tasks: 0 }, error: err?.message ?? "Unknown error" };
  }
}
