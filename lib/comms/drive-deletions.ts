import "server-only";
import { prisma } from "@/lib/prisma";
import { reportIssue } from "@/lib/system-issues";
import { removeDriveFile } from "@/lib/google-drive";

/// After this many tries a file stays in drive_file_deletions untried, for
/// a person (and the morning check) to see. Ten nights is long enough for
/// a passing Drive or token outage to clear.
export const MAX_DRIVE_DELETION_ATTEMPTS = 10;

/// Remove a Drive file whose rows are about to be deleted (27.11.2026).
///
/// Retention, a block and the end of an engagement deleted the rows that
/// point at audio and ignored whether Drive actually removed the file.
/// When it did not, the audio stayed in Drive and nothing could find it
/// again: the one record of its id was gone. The rows still go (what was
/// blocked or expired must leave the app), and a file Drive refused waits
/// in drive_file_deletions for the nightly retry.
export async function removeDriveFileOrQueue(fileId: string, reason: string): Promise<boolean> {
  const removed = await removeDriveFile(fileId);
  if (removed.ok) return true;
  // Retried every night (retryDriveFileDeletions); an issue only if it never goes.
  console.warn("drive deletion: Drive refused, queued for retry", { fileId, reason, error: removed.error });
  await prisma.driveFileDeletion.upsert({
    where: { fileId },
    create: { fileId, reason, lastError: removed.error },
    update: { lastError: removed.error, attemptedAt: new Date(), attempts: { increment: 1 } },
  });
  return false;
}

/// The nightly retry of files Drive refused to delete before.
export async function retryDriveFileDeletions(now = new Date()): Promise<{ removed: number; failed: number }> {
  const pending = await prisma.driveFileDeletion.findMany({
    where: { attempts: { lt: MAX_DRIVE_DELETION_ATTEMPTS } },
    orderBy: { attemptedAt: "asc" },
    take: 200,
  });
  let removed = 0;
  let failed = 0;
  for (const row of pending) {
    const result = await removeDriveFile(row.fileId);
    if (result.ok) {
      await prisma.driveFileDeletion.delete({ where: { fileId: row.fileId } });
      removed += 1;
    } else {
      const updated = await prisma.driveFileDeletion.update({
        where: { fileId: row.fileId },
        data: { lastError: result.error, attemptedAt: now, attempts: { increment: 1 } },
      });
      failed += 1;
      if (updated.attempts >= MAX_DRIVE_DELETION_ATTEMPTS) {
        await reportIssue({
          area: "comms",
          key: `drive-deletion:${row.fileId}`,
          title: `קובץ שמע שצריך היה להימחק (${row.reason}) נשאר ב-Drive אחרי ${MAX_DRIVE_DELETION_ATTEMPTS} ניסיונות`,
          detail: `Drive file ${row.fileId}: ${result.error ?? ""}`.slice(0, 400),
          severity: "CRITICAL",
        });
      }
    }
  }
  return { removed, failed };
}
