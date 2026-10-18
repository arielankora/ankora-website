import "server-only";
import { recordAudit } from "@/lib/app-auth/audit";
import {
  DRIVE_FOLDER_CODE_SNAPSHOTS,
  listFilesInFolder,
  uploadLargeFileToDriveFolder,
} from "@/lib/google-drive";
import { sweepBackupFolder, type RetentionSweepResult } from "@/lib/app-domain/backup-retention";

// Weekly snapshot of this repo's source code into Google Drive.
//
// Until October 2026 this was a Claude-side scheduled task: clone the repo
// in an AI sandbox, tar it, base64 it, and hand the string to a Drive MCP
// tool. It never delivered a single file. Five weekly runs failed at the
// same step, for the same structural reason the nightly relay failed in
// September (docs/adr/0001 sections 22.7 and 22.10): an agent's tool call
// is not a pipe for tens of megabytes of bytes. The fix is the same one,
// too: the server uploads it itself, server to server.
//
// What the server does NOT do is run git. GitHub already builds a tarball
// of every ref on request (the same bytes `git archive` would produce,
// without `.git`), so the whole "clone and pack" step is one fetch. History
// is not part of the snapshot on purpose: GitHub keeps it, and this copy
// exists for the day GitHub (or the account) is the thing that failed.
//
// Cadence: the scheduled-reports cron runs daily at 00:00 UTC, and this
// project cannot add a cron of its own (see that route's header). So the
// job decides for itself whether today is the day, the same way
// report-schedules.ts decides for weekly client reports inside a daily
// cron. Sunday UTC: arbitrary, but fixed, and the day the old task ran.
//
// Retention: the newest eight snapshots, by count. Two months of weekly
// restore points. The sweep only runs after a successful upload, and only
// touches files whose name matches the pattern below, both rules inherited
// from backup-retention.ts.

export const CODE_BACKUP_REPO = { owner: "arielankora", repo: "ankora-website", ref: "main" } as const;
export const CODE_BACKUP_WEEKDAY_UTC = 0; // Sunday
export const CODE_BACKUP_KEEP = 8;
export const CODE_SNAPSHOT_NAME = /^ankora-website-code-\d{4}-\d{2}-\d{2}\.tar\.gz$/;

/// Generous ceiling: the tarball is 22 MB today. Past this, holding the
/// whole file in one function's memory stops being a reasonable design,
/// and the run says so instead of finding out from an out-of-memory crash.
export const CODE_BACKUP_MAX_BYTES = 250 * 1024 * 1024;

/// A real tarball of this repo is megabytes. Anything this small is an
/// error page that came back with a 200, not a snapshot.
const CODE_BACKUP_MIN_BYTES = 64 * 1024;

/// Pure: is today the weekly backup day. Exported for tests.
export function isCodeBackupDue(now: Date): boolean {
  return now.getUTCDay() === CODE_BACKUP_WEEKDAY_UTC;
}

/// Pure: the snapshot's file name. UTC date, matching the cadence check.
export function codeSnapshotName(now: Date): string {
  return `ankora-website-code-${now.toISOString().slice(0, 10)}.tar.gz`;
}

/// Where to fetch the tarball. With GITHUB_TOKEN (already set in Vercel for
/// blog publishing, contents scope on this repo) it goes through the API,
/// which works whether the repo is public or private. Without one, the
/// public codeload URL. Either way GitHub answers with the same bytes.
export function codeTarballRequest(env: NodeJS.ProcessEnv = process.env): { url: string; headers: Record<string, string> } {
  const { owner, repo, ref } = CODE_BACKUP_REPO;
  const token = env.GITHUB_TOKEN;
  if (token) {
    return {
      url: `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    };
  }
  return { url: `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${ref}`, headers: {} };
}

export interface CodeBackupResult {
  ok: boolean;
  skipped?: string;
  name?: string;
  bytes?: number;
  fileId?: string;
  retention?: RetentionSweepResult;
  error?: string;
}

async function fetchTarball(): Promise<{ ok: true; content: Buffer } | { ok: false; error: string }> {
  const { url, headers } = codeTarballRequest();
  try {
    const res = await fetch(url, { headers, redirect: "follow", cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `GitHub tarball fetch failed ${res.status}` };
    }
    const content = Buffer.from(await res.arrayBuffer());
    if (content.length > CODE_BACKUP_MAX_BYTES) {
      return { ok: false, error: `Tarball is ${content.length} bytes, over the ${CODE_BACKUP_MAX_BYTES} ceiling` };
    }
    // gzip magic bytes. Cheap, and it turns "uploaded an HTML error page as
    // a backup" from a silent failure into a logged one.
    if (content.length < CODE_BACKUP_MIN_BYTES || content[0] !== 0x1f || content[1] !== 0x8b) {
      return { ok: false, error: `GitHub returned ${content.length} bytes that are not a gzip tarball` };
    }
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error fetching tarball" };
  }
}

async function audit(sent: boolean, after: unknown) {
  try {
    await recordAudit({
      actorId: null,
      action: sent ? "backup.code_snapshot.sent" : "backup.code_snapshot.upload_failed",
      entityType: "System",
      after,
    });
  } catch (err) {
    // The audit row is how a failed backup becomes visible, but failing to
    // write it must not turn a delivered snapshot into a reported failure.
    console.error("Code backup: could not record audit event:", err);
  }
}

/// Runs the weekly code snapshot if today is the day. Never throws.
export async function backupCodeSnapshotToDrive(now: Date = new Date()): Promise<CodeBackupResult> {
  if (!isCodeBackupDue(now)) {
    return { ok: true, skipped: "not the weekly backup day" };
  }

  const name = codeSnapshotName(now);

  try {
    // Idempotent per day: a manual re-run of the cron must not leave two
    // files with the same name, which is exactly the ambiguity that made
    // the September duplicates dangerous in a restore.
    const existing = await listFilesInFolder(DRIVE_FOLDER_CODE_SNAPSHOTS);
    if (existing.ok && existing.files?.some((f) => f.name === name)) {
      return { ok: true, skipped: "today's snapshot is already in Drive", name };
    }

    const tarball = await fetchTarball();
    if (!tarball.ok) {
      console.error("Code backup: fetch failed:", tarball.error);
      await audit(false, { name, stage: "fetch", error: tarball.error });
      return { ok: false, name, error: tarball.error };
    }

    const uploaded = await uploadLargeFileToDriveFolder({
      name,
      mimeType: "application/gzip",
      content: tarball.content,
      folderId: DRIVE_FOLDER_CODE_SNAPSHOTS,
    });
    if (!uploaded.ok) {
      console.error("Code backup: Drive upload failed:", uploaded.error);
      await audit(false, {
        name,
        stage: "upload",
        bytes: tarball.content.length,
        error: uploaded.error,
      });
      return { ok: false, name, bytes: tarball.content.length, error: uploaded.error };
    }

    const retention = await sweepBackupFolder({
      folderId: DRIVE_FOLDER_CODE_SNAPSHOTS,
      namePattern: CODE_SNAPSHOT_NAME,
      uploadSucceededTonight: true,
      now,
      retentionDays: 0,
      minKeep: CODE_BACKUP_KEEP,
    });
    if (!retention.ok) console.error("Code backup: retention sweep failed:", retention.error);

    const result: CodeBackupResult = {
      ok: true,
      name,
      bytes: tarball.content.length,
      fileId: uploaded.fileId,
      retention,
    };
    await audit(true, result);
    return result;
  } catch (err) {
    console.error("backupCodeSnapshotToDrive failed:", err);
    return { ok: false, name, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
