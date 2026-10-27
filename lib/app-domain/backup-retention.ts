import "server-only";
import { listFilesInFolder, removeDriveFile, type DriveFileSummary } from "@/lib/google-drive";

// How long a nightly backup lives in Google Drive.
//
// Until October 2026 the nightly Excel report and database dump were kept
// forever. That made two of Ankora's own commitments untrue: the DPA says
// copies in backups "are deleted in the ordinary backup cycle", and the
// security page says backups are deleted after 35 days. A cycle that never
// ends is not a cycle. This module is what makes both sentences true.
//
// Why 35 days: a month of nightly restore points, plus a margin so a
// problem noticed at the start of a month can still be traced to the
// state at the start of the month before. Neon's own point-in-time
// recovery covers the short window; these files are the longer one.
//
// Two rules keep a retention sweep from becoming the incident:
//
//  1. It runs only for a folder whose upload succeeded tonight. If the
//     nightly backup has been failing, the old files are the only backups
//     there are, and deleting them by age would leave nothing.
//  2. The newest MIN_KEEP files are never deleted, whatever their age.
//     Belt and braces for the same failure: even a sweep that runs after
//     weeks of silence keeps a week of restore points.
//
// And one rule keeps it from touching anything it did not make: it only
// considers files whose name matches the nightly naming pattern. A file
// someone put in the folder by hand is left alone.

export const BACKUP_RETENTION_DAYS = 35;
export const BACKUP_MIN_KEEP = 7;

/// The names sendNightlyDataExport() gives its two files.
export const NIGHTLY_EXCEL_NAME = /^ankora-נתונים-\d{4}-\d{2}-\d{2}\.xlsx$/;
export const NIGHTLY_DUMP_NAME = /^ankora-database-dump-\d{4}-\d{2}-\d{2}\.json\.gz$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/// Pure: which files in a folder are past retention. Exported for tests.
export function selectExpiredBackups(
  files: DriveFileSummary[],
  now: Date,
  namePattern: RegExp,
  retentionDays: number = BACKUP_RETENTION_DAYS,
  minKeep: number = BACKUP_MIN_KEEP,
): DriveFileSummary[] {
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const ours = files
    .filter((f) => namePattern.test(f.name))
    .filter((f) => !Number.isNaN(Date.parse(f.createdTime)))
    .sort((a, b) => Date.parse(b.createdTime) - Date.parse(a.createdTime));
  return ours.slice(minKeep).filter((f) => Date.parse(f.createdTime) < cutoff);
}

export interface RetentionSweepResult {
  ok: boolean;
  skipped?: string;
  deleted: number;
  trashed: number;
  failed: number;
  error?: string;
}

/// Lists one folder and removes what is past retention. Never throws.
export async function sweepBackupFolder(params: {
  folderId: string;
  namePattern: RegExp;
  uploadSucceededTonight: boolean;
  now: Date;
  /// Defaults are the nightly policy. The weekly code snapshot passes its
  /// own (lib/app-domain/code-backup.ts): keep the newest eight, by count.
  retentionDays?: number;
  minKeep?: number;
}): Promise<RetentionSweepResult> {
  const empty = { deleted: 0, trashed: 0, failed: 0 };
  if (!params.uploadSucceededTonight) {
    return { ok: true, skipped: "tonight's upload failed; keeping every existing backup", ...empty };
  }

  const listed = await listFilesInFolder(params.folderId);
  if (!listed.ok || !listed.files) {
    return { ok: false, error: listed.error ?? "Drive list returned no files array", ...empty };
  }

  const expired = selectExpiredBackups(
    listed.files,
    params.now,
    params.namePattern,
    params.retentionDays ?? BACKUP_RETENTION_DAYS,
    params.minKeep ?? BACKUP_MIN_KEEP,
  );
  const result: RetentionSweepResult = { ok: true, ...empty };
  // One at a time: at most one file ages out per folder per night in steady
  // state, so there is nothing to gain from parallelism and a lot to lose
  // from a burst against Drive's rate limit on the first run, when the whole
  // backlog goes at once.
  for (const file of expired) {
    const removed = await removeDriveFile(file.id);
    if (!removed.ok) {
      result.failed += 1;
      result.ok = false;
      result.error = `${result.failed} of ${expired.length} expired file(s) could not be removed`;
      console.error(`Backup retention: could not remove ${file.name}:`, removed.error);
    } else if (removed.how === "trashed") {
      result.trashed += 1;
    } else {
      result.deleted += 1;
    }
  }
  return result;
}
