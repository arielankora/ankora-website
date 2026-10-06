import "server-only";
import { gzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { toXlsxWorkbook } from "@/lib/xlsx";
import { recordAudit } from "@/lib/app-auth/audit";
import { localDateKey } from "@/lib/timezone";
import { uploadFileToDriveFolder, DRIVE_FOLDER_EXCEL_REPORTS, DRIVE_FOLDER_DB_DUMPS } from "@/lib/google-drive";
import { buildDump, prismaExecutor, totalRows, largestTables } from "@/lib/app-domain/backup-dump";
import { DUMP_SIZE_WARN_BYTES, DUMP_EMAIL_ATTACH_MAX_BYTES } from "@/lib/app-domain/backup-coverage";
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
//  2. A gzipped JSON dump of every table the coverage map
//     (lib/app-domain/backup-coverage.ts) says to dump - which as of
//     2026-09-29 is thirty of the schema's thirty-six tables, the six
//     exceptions all being credential tables that hold hashes and are
//     re-issued rather than restored.
//
//     This used to be six tables, hand-listed in this file. That list
//     could not tell anyone it had fallen behind, and it had: it was
//     missing BillingPolicy and HourBankAdjustment, so the dump could
//     not deliver what this comment claimed for it ("who is owed
//     what"). Coverage is now a decision per model, recorded in one
//     place, and a unit test fails the build when a new model is added
//     to the schema without one. See that file's header for the two
//     rules that are easy to get wrong (soft-deleted rows ARE dumped;
//     a skip must name its recovery path).
//
//     Neon PITR remains the full-fidelity backup within its retention
//     window. This dump is what survives the window closing, or the
//     Neon project going away entirely, and
//     tests/integration/backup-restore-roundtrip.test.ts is the proof
//     that it actually restores rather than merely existing.
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
  dump?: {
    tables: number;
    rows: number;
    compressedBytes: number;
    schemaMigration: string | null;
    attachedToEmail: boolean;
    problems: string[];
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
    // subtasks-included: the-backup-sheet. A backup that omits the steps
    // under a task is a backup that cannot restore the task. Every other
    // task query in this product excludes them (see TOP_LEVEL_ONLY in
    // app-domain/tasks.ts); this one and the dump below must not.
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

    const dump = await buildDump(prismaExecutor(prisma), now);
    const dumpGz = gzipSync(Buffer.from(JSON.stringify(dump)));

    // Three things can be true about a dump that was produced without
    // throwing, and all three are worth saying out loud in the logs
    // rather than discovering during a restore.
    for (const problem of dump.problems) console.error("Nightly dump problem:", problem);
    if (dumpGz.length > DUMP_SIZE_WARN_BYTES) {
      console.warn(
        `Nightly dump is ${dumpGz.length} bytes compressed, over the ${DUMP_SIZE_WARN_BYTES} warning threshold. ` +
          `Largest tables: ${largestTables(dump).map((t) => `${t.table}=${t.rows}`).join(", ")}. ` +
          `This design (whole database as JSON, in one function invocation) has a ceiling; at this size the history ` +
          `tables want a real pg_dump on their own schedule instead.`
      );
    }
    // Over the hard cap the dump still reaches Drive in full, it just
    // stops riding along on the email: a message Resend rejects for
    // size delivers neither file, which is the worse failure.
    const attachDumpToEmail = dumpGz.length <= DUMP_EMAIL_ATTACH_MAX_BYTES;
    if (!attachDumpToEmail) {
      console.warn(`Nightly dump (${dumpGz.length} bytes) exceeds the email attachment cap; sent to Drive only.`);
    }

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
          attachDumpToEmail
            ? `שני קבצים מצורפים: אקסל מסודר לקריאה, וקובץ גיבוי דחוס (JSON) שמיועד לארכוב בלבד ולא לקריאה ישירה.`
            : `מצורף קובץ האקסל בלבד. קובץ הגיבוי הדחוס גדול מדי לשליחה במייל והועלה לגוגל דרייב בלבד.`,
        ].join("\n"),
        attachments: attachDumpToEmail
          ? [
              { filename: excelFilename, content: excelBuffer },
              { filename: dumpFilename, content: dumpGz, contentType: "application/gzip" },
            ]
          : [{ filename: excelFilename, content: excelBuffer }],
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
        dump: {
          tables: Object.keys(dump.tables).length,
          rows: totalRows(dump),
          compressedBytes: dumpGz.length,
          schemaMigration: dump.schemaMigration,
          problems: dump.problems.length,
        },
      },
    });

    return {
      ok: result.ok,
      counts,
      error: result.error,
      drive: { excel: driveExcel, dbDump: driveDump },
      dump: {
        tables: Object.keys(dump.tables).length,
        rows: totalRows(dump),
        compressedBytes: dumpGz.length,
        schemaMigration: dump.schemaMigration,
        attachedToEmail: attachDumpToEmail,
        problems: dump.problems,
      },
    };
  } catch (err: any) {
    // Never throw - see doc comment above. Logged (Vercel's runtime
    // logs) rather than silently swallowed.
    console.error("sendNightlyDataExport failed:", err);
    return { ok: false, counts: { clients: 0, timeEntries: 0, tasks: 0 }, error: err?.message ?? "Unknown error" };
  }
}
