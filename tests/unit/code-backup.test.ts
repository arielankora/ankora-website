/// Weekly code snapshot to Drive (lib/app-domain/code-backup.ts).
///
/// Drive, the audit log and GitHub are all mocked. The properties worth
/// protecting: it runs only on its day, never writes two files for one day,
/// never uploads something that is not a tarball, and every failure is both
/// returned and audited rather than thrown.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-drive", () => ({
  DRIVE_FOLDER_CODE_SNAPSHOTS: "code-folder",
  listFilesInFolder: vi.fn(),
  uploadLargeFileToDriveFolder: vi.fn(),
}));
vi.mock("@/lib/app-domain/backup-retention", () => ({ sweepBackupFolder: vi.fn() }));
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit: vi.fn() }));

import { listFilesInFolder, uploadLargeFileToDriveFolder } from "@/lib/google-drive";
import { sweepBackupFolder } from "@/lib/app-domain/backup-retention";
import { recordAudit } from "@/lib/app-auth/audit";
import {
  CODE_BACKUP_KEEP,
  CODE_SNAPSHOT_NAME,
  backupCodeSnapshotToDrive,
  codeSnapshotName,
  codeTarballRequest,
  isCodeBackupDue,
} from "@/lib/app-domain/code-backup";

const SUNDAY = new Date("2026-10-18T00:00:30Z");
const MONDAY = new Date("2026-10-19T00:00:30Z");

/// A buffer that passes the gzip-magic and minimum-size checks.
function fakeTarball(bytes = 200 * 1024) {
  const b = Buffer.alloc(bytes, 7);
  b[0] = 0x1f;
  b[1] = 0x8b;
  return b;
}

describe("code backup: pure parts", () => {
  it("is due on Sunday UTC only", () => {
    expect(isCodeBackupDue(SUNDAY)).toBe(true);
    expect(isCodeBackupDue(MONDAY)).toBe(false);
    // Saturday 23:30 UTC is already Sunday in Israel, and still not the day:
    // the cadence is UTC, matching the cron.
    expect(isCodeBackupDue(new Date("2026-10-17T23:30:00Z"))).toBe(false);
  });

  it("names the file the way the old task did, and the retention pattern matches it", () => {
    expect(codeSnapshotName(SUNDAY)).toBe("ankora-website-code-2026-10-18.tar.gz");
    expect(CODE_SNAPSHOT_NAME.test(codeSnapshotName(SUNDAY))).toBe(true);
    expect(CODE_SNAPSHOT_NAME.test("ankora-website-code-2026-10-18-manual.tar.gz")).toBe(false);
  });

  it("uses the API with the token when there is one, codeload without", () => {
    const withToken = codeTarballRequest({ GITHUB_TOKEN: "t" } as any);
    expect(withToken.url).toBe("https://api.github.com/repos/arielankora/ankora-website/tarball/main");
    expect(withToken.headers.Authorization).toBe("Bearer t");

    const without = codeTarballRequest({} as any);
    expect(without.url).toBe("https://codeload.github.com/arielankora/ankora-website/tar.gz/refs/heads/main");
    expect(without.headers).toEqual({});
  });
});

describe("backupCodeSnapshotToDrive()", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.mocked(listFilesInFolder).mockReset().mockResolvedValue({ ok: true, files: [] });
    vi.mocked(uploadLargeFileToDriveFolder).mockReset().mockResolvedValue({ ok: true, fileId: "new-id" });
    vi.mocked(sweepBackupFolder)
      .mockReset()
      .mockResolvedValue({ ok: true, deleted: 0, trashed: 0, failed: 0 });
    vi.mocked(recordAudit).mockReset().mockResolvedValue(undefined as any);
    global.fetch = vi.fn(async () => new Response(fakeTarball(), { status: 200 })) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does nothing at all on any other day", async () => {
    const result = await backupCodeSnapshotToDrive(MONDAY);

    expect(result).toMatchObject({ ok: true, skipped: expect.any(String) });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(listFilesInFolder).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("fetches, uploads, sweeps to the newest eight, and audits the success", async () => {
    const result = await backupCodeSnapshotToDrive(SUNDAY);

    expect(result).toMatchObject({ ok: true, name: "ankora-website-code-2026-10-18.tar.gz", fileId: "new-id" });
    const upload = vi.mocked(uploadLargeFileToDriveFolder).mock.calls[0][0];
    expect(upload).toMatchObject({
      name: "ankora-website-code-2026-10-18.tar.gz",
      mimeType: "application/gzip",
      folderId: "code-folder",
    });
    expect(upload.content[0]).toBe(0x1f);
    expect(sweepBackupFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: "code-folder",
        namePattern: CODE_SNAPSHOT_NAME,
        uploadSucceededTonight: true,
        retentionDays: 0,
        minKeep: CODE_BACKUP_KEEP,
      }),
    );
    expect(CODE_BACKUP_KEEP).toBe(8);
    expect(vi.mocked(recordAudit).mock.calls[0][0]).toMatchObject({ action: "backup.code_snapshot.sent" });
  });

  it("skips when today's snapshot is already there, so a re-run leaves one file per day", async () => {
    vi.mocked(listFilesInFolder).mockResolvedValue({
      ok: true,
      files: [{ id: "x", name: "ankora-website-code-2026-10-18.tar.gz", createdTime: SUNDAY.toISOString() }],
    });

    const result = await backupCodeSnapshotToDrive(SUNDAY);

    expect(result.skipped).toMatch(/already/);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(uploadLargeFileToDriveFolder).not.toHaveBeenCalled();
  });

  it("reports and audits a GitHub failure, and uploads nothing", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 404 })) as any;

    const result = await backupCodeSnapshotToDrive(SUNDAY);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/404/);
    expect(uploadLargeFileToDriveFolder).not.toHaveBeenCalled();
    expect(vi.mocked(recordAudit).mock.calls[0][0]).toMatchObject({
      action: "backup.code_snapshot.upload_failed",
      after: expect.objectContaining({ stage: "fetch" }),
    });
  });

  it("refuses to upload a 200 response that is not a gzip tarball", async () => {
    global.fetch = vi.fn(async () => new Response("<html>rate limited</html>", { status: 200 })) as any;

    const result = await backupCodeSnapshotToDrive(SUNDAY);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a gzip tarball/);
    expect(uploadLargeFileToDriveFolder).not.toHaveBeenCalled();
  });

  it("reports and audits a Drive failure, and does not sweep (the old snapshots are all there is)", async () => {
    vi.mocked(uploadLargeFileToDriveFolder).mockResolvedValue({ ok: false, error: "Drive upload failed 403" });

    const result = await backupCodeSnapshotToDrive(SUNDAY);

    expect(result.ok).toBe(false);
    expect(sweepBackupFolder).not.toHaveBeenCalled();
    expect(vi.mocked(recordAudit).mock.calls[0][0]).toMatchObject({
      action: "backup.code_snapshot.upload_failed",
      after: expect.objectContaining({ stage: "upload" }),
    });
  });

  it("still reports a delivered snapshot as delivered when the audit write fails", async () => {
    vi.mocked(recordAudit).mockRejectedValue(new Error("db down"));

    const result = await backupCodeSnapshotToDrive(SUNDAY);

    expect(result.ok).toBe(true);
  });

  it("never throws, even when Drive listing itself throws", async () => {
    vi.mocked(listFilesInFolder).mockRejectedValue(new Error("boom"));

    const result = await backupCodeSnapshotToDrive(SUNDAY);

    expect(result).toMatchObject({ ok: false, error: "boom" });
  });
});
