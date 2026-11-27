import { reconcileScheduledReports } from "@/lib/app-domain/report-schedules";
import { sendNightlyDataExport } from "@/lib/app-domain/backup-export";
import { backupCodeSnapshotToDrive } from "@/lib/app-domain/code-backup";
import { isFailedStep, runCron } from "@/lib/cron-run";
import { reportIssue, resolveIssue } from "@/lib/system-issues";

// Spec 15's weekly/monthly scheduled email reports, checked hourly (finer
// grained than Phase 4's once-daily alerts-reconcile cron, since a
// schedule's configured `hour` needs to be matched within the same hour
// it falls in - see lib/app-domain/report-schedules.ts's isScheduleDue).
// Same CRON_SECRET bearer-token protection as
// app/api/cron/alerts-reconcile/route.ts.
//
// Phase 11 addition: also runs sendNightlyDataExport() (the nightly
// Excel report + JSON backup dump emailed to ariel@ankora.co.il and
// hadas@ankora.co.il, per Ariel's direct request). This is the same
// "fold a new daily job into one of the two existing crons" pattern
// app/api/cron/alerts-reconcile/route.ts already uses for
// notifyLongRunningTimers()/reconcileImportantDates() - this project's
// Vercel plan (Hobby) allows at most 2 Cron Jobs, both already spoken
// for, so a third standalone route is not an option (see
// lib/app-domain/report-schedules.ts's isScheduleDue doc comment for
// the same constraint, independently documented).
//
// This is the cron chosen to carry the new job (over alerts-reconcile)
// specifically because it's already the "email reports" cron -
// thematically the closer fit - and because its schedule can move
// within vercel.json without touching alerts-reconcile's unrelated jobs
// (client alert reconciliation, long-timer notifications, important-date
// reminders), which have their own established run time. Ariel asked for
// the nightly export to run at 03:00 Israel time; vercel.json's schedule
// for this route was changed to "0 0 * * *" (00:00 UTC) to match -
// 03:00 Israel during IDT/daylight saving (UTC+3, in effect roughly
// late March-late October). Known limitation, not yet solved: Vercel
// Cron schedules are fixed UTC, with no timezone-aware/DST-following
// option, so this will actually fire at 02:00 Israel time once the
// clocks fall back to IST (UTC+2) in late October - flagged in the
// backup plan doc as an open item, revisit the UTC offset twice a year
// (or when Vercel adds timezone-aware cron) if exact 03:00 matters.
// Moving this cron's fire time does not affect WEEKLY/MONTHLY client
// report schedules' own accuracy: isScheduleDue only checks
// day-of-week/day-of-month (never `hour`, per its own doc comment) and
// 00:00-03:00 UTC is still the same Israel calendar day as the previous
// 06:00 UTC fire time, so which day a schedule is due on is unchanged.
//
// Also carries the weekly code snapshot (lib/app-domain/code-backup.ts),
// for the same reason: no cron slot of its own. It decides for itself
// that today is Sunday UTC and returns a skip on every other day.
export async function GET(request: Request) {
  // Each its own step (27.11.2026): the nightly export failing no longer
  // hides whether the reports went out, and the other way around.
  return runCron("scheduled-reports", request, async (step) => {
    const [result, nightlyExport, codeBackup] = await Promise.all([
      step("reports", () => reconcileScheduledReports()),
      step("nightlyExport", () => sendNightlyDataExport()),
      step("codeBackup", () => backupCodeSnapshotToDrive()),
    ]);
    await reportBackups(nightlyExport, codeBackup);
    return { result, nightlyExport, codeBackup };
  });
}

/// The two backups never throw: they return ok: false, which used to reach
/// only this route's JSON answer (27.11.2026, silent failures audit). A night
/// with no backup in Drive is a system issue; a good night closes it.
async function reportBackups(nightly: unknown, code: unknown) {
  if (nightly && typeof nightly === "object" && !isFailedStep(nightly)) {
    const n = nightly as { ok: boolean; error?: string; drive?: { excel?: { ok: boolean }; dbDump?: { ok: boolean } } };
    const inDrive = n.drive ? n.drive.excel?.ok !== false && n.drive.dbDump?.ok !== false : n.ok;
    if (n.ok && inDrive) await resolveIssue("backup", "nightly");
    else
      await reportIssue({
        area: "backup",
        key: "nightly",
        title: n.ok ? "הגיבוי הלילי לא הועלה ל-Drive" : "הגיבוי הלילי נכשל",
        detail: `${n.error ?? ""} excel:${n.drive?.excel?.ok ?? "?"} dbDump:${n.drive?.dbDump?.ok ?? "?"}`.slice(0, 400),
        severity: "CRITICAL",
      });
  }
  if (code && typeof code === "object" && !isFailedStep(code)) {
    const c = code as { ok: boolean; skipped?: string; error?: string };
    if (c.ok) {
      if (!c.skipped) await resolveIssue("backup", "code");
    } else await reportIssue({ area: "backup", key: "code", title: "הגיבוי השבועי של הקוד ל-Drive נכשל", detail: c.error?.slice(0, 400), severity: "CRITICAL" });
  }
}
