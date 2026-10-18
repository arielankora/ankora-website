/// Backup retention: Drive keeps 35 days of nightly backups, not forever.
///
/// The selection rule is pure and tested directly. The sweep is tested
/// against a mocked Drive, because the property worth protecting is not
/// "old files go" but "the sweep never deletes the only backups there are".

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-drive", () => ({
  listFilesInFolder: vi.fn(),
  removeDriveFile: vi.fn(),
}));

import { listFilesInFolder, removeDriveFile } from "@/lib/google-drive";
import {
  BACKUP_MIN_KEEP,
  BACKUP_RETENTION_DAYS,
  NIGHTLY_DUMP_NAME,
  NIGHTLY_EXCEL_NAME,
  selectExpiredBackups,
  sweepBackupFolder,
} from "@/lib/app-domain/backup-retention";

const NOW = new Date("2026-10-15T00:47:00Z");
const DAY = 24 * 60 * 60 * 1000;

/// One nightly dump per day, `count` days back from NOW (day 0 = tonight).
function nightlyDumps(count: number) {
  return Array.from({ length: count }, (_, daysAgo) => {
    const t = new Date(NOW.getTime() - daysAgo * DAY);
    const key = t.toISOString().slice(0, 10);
    return { id: `id-${key}`, name: `ankora-database-dump-${key}.json.gz`, createdTime: t.toISOString() };
  });
}

describe("selectExpiredBackups()", () => {
  it("keeps 35 days and removes what is older", () => {
    const files = nightlyDumps(40); // days 0..39
    const expired = selectExpiredBackups(files, NOW, NIGHTLY_DUMP_NAME);
    // Day 35 is exactly at the cutoff and stays; days 36..39 go.
    expect(expired.map((f) => f.id).sort()).toEqual(
      ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"].map((d) => `id-${d}`),
    );
  });

  it("always keeps the newest files, however old they are", () => {
    // The nightly job was down for two months. Every file is past
    // retention, and the newest of them are still the only restore points.
    const old = nightlyDumps(100).slice(60);
    const expired = selectExpiredBackups(old, NOW, NIGHTLY_DUMP_NAME);
    expect(expired).toHaveLength(old.length - BACKUP_MIN_KEEP);
    const keptNewest = old.slice(0, BACKUP_MIN_KEEP).map((f) => f.id);
    for (const id of keptNewest) expect(expired.map((f) => f.id)).not.toContain(id);
  });

  it("never touches a file it did not name", () => {
    const files = [
      ...nightlyDumps(3),
      { id: "hand", name: "notes from the restore drill.txt", createdTime: "2025-01-01T00:00:00Z" },
      { id: "excel", name: "ankora-נתונים-2025-01-01.xlsx", createdTime: "2025-01-01T00:00:00Z" },
    ];
    expect(selectExpiredBackups(files, NOW, NIGHTLY_DUMP_NAME, BACKUP_RETENTION_DAYS, 0)).toEqual([]);
    expect(selectExpiredBackups(files, NOW, NIGHTLY_EXCEL_NAME, BACKUP_RETENTION_DAYS, 0).map((f) => f.id)).toEqual(["excel"]);
  });

  it("ignores a file whose creation time it cannot read", () => {
    const files = [{ id: "x", name: "ankora-database-dump-2020-01-01.json.gz", createdTime: "not a date" }];
    expect(selectExpiredBackups(files, NOW, NIGHTLY_DUMP_NAME, BACKUP_RETENTION_DAYS, 0)).toEqual([]);
  });
});

describe("sweepBackupFolder()", () => {
  beforeEach(() => {
    vi.mocked(listFilesInFolder).mockReset();
    vi.mocked(removeDriveFile).mockReset();
  });

  it("does not even list the folder when tonight's upload failed", async () => {
    const result = await sweepBackupFolder({
      folderId: "f",
      namePattern: NIGHTLY_DUMP_NAME,
      uploadSucceededTonight: false,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBeTruthy();
    expect(listFilesInFolder).not.toHaveBeenCalled();
  });

  it("removes the expired files and reports deleted versus trashed", async () => {
    vi.mocked(listFilesInFolder).mockResolvedValue({ ok: true, files: nightlyDumps(38) }); // 2 expired
    vi.mocked(removeDriveFile)
      .mockResolvedValueOnce({ ok: true, how: "deleted" })
      .mockResolvedValueOnce({ ok: true, how: "trashed" });

    const result = await sweepBackupFolder({
      folderId: "f",
      namePattern: NIGHTLY_DUMP_NAME,
      uploadSucceededTonight: true,
      now: NOW,
    });

    expect(removeDriveFile).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true, deleted: 1, trashed: 1, failed: 0 });
  });

  it("reports a failure without throwing, and keeps going", async () => {
    vi.mocked(listFilesInFolder).mockResolvedValue({ ok: true, files: nightlyDumps(38) });
    vi.mocked(removeDriveFile)
      .mockResolvedValueOnce({ ok: false, error: "403" })
      .mockResolvedValueOnce({ ok: true, how: "deleted" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sweepBackupFolder({
      folderId: "f",
      namePattern: NIGHTLY_DUMP_NAME,
      uploadSucceededTonight: true,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, deleted: 1, failed: 1 });
  });

  it("reports a failed listing without deleting anything", async () => {
    vi.mocked(listFilesInFolder).mockResolvedValue({ ok: false, error: "drive is down" });
    const result = await sweepBackupFolder({
      folderId: "f",
      namePattern: NIGHTLY_DUMP_NAME,
      uploadSucceededTonight: true,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(removeDriveFile).not.toHaveBeenCalled();
  });
});

describe("sweepBackupFolder() with a count-based policy", () => {
  beforeEach(() => {
    vi.mocked(listFilesInFolder).mockReset();
    vi.mocked(removeDriveFile).mockReset();
  });

  it("keeps exactly the newest N when retentionDays is 0 (the weekly code snapshot)", async () => {
    const weekly = Array.from({ length: 10 }, (_, weeksAgo) => {
      const t = new Date(NOW.getTime() - weeksAgo * 7 * DAY);
      const key = t.toISOString().slice(0, 10);
      return { id: `code-${key}`, name: `ankora-website-code-${key}.tar.gz`, createdTime: t.toISOString() };
    });
    vi.mocked(listFilesInFolder).mockResolvedValue({ ok: true, files: weekly });
    vi.mocked(removeDriveFile).mockResolvedValue({ ok: true, how: "trashed" });

    const result = await sweepBackupFolder({
      folderId: "code",
      namePattern: /^ankora-website-code-\d{4}-\d{2}-\d{2}\.tar\.gz$/,
      uploadSucceededTonight: true,
      now: NOW,
      retentionDays: 0,
      minKeep: 8,
    });

    expect(result).toMatchObject({ ok: true, trashed: 2, deleted: 0, failed: 0 });
    expect(vi.mocked(removeDriveFile).mock.calls.map((c) => c[0]).sort()).toEqual(
      [weekly[8].id, weekly[9].id].sort(),
    );
  });
});
