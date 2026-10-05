import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry } from "./factories";

// Phase 11 - the nightly backup and data export. Needs a real Prisma client and a
// reachable DATABASE_URL; see tests/integration/setup.ts's header comment.
//
// The pure row-shaping lives in backup-export-format and is unit tested. What is only
// testable here is the orchestration, and the property worth protecting is the one the
// implementation went out of its way to get right: the email, the Excel upload and the
// dump upload are three independent calls, so a failing Google Drive must not cost us
// the nightly email. That is the difference between a bad night and a lost backup.

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

vi.mock("@/lib/google-drive", () => ({
  uploadFileToDriveFolder: vi.fn(),
  DRIVE_FOLDER_EXCEL_REPORTS: "excel-folder",
  DRIVE_FOLDER_DB_DUMPS: "dump-folder",
}));

import { gunzipSync } from "node:zlib";
import { sendEmail } from "@/lib/email";
import { uploadFileToDriveFolder } from "@/lib/google-drive";
import { sendNightlyDataExport } from "@/lib/app-domain/backup-export";
import { dumpedTables, REDACTED_PASSWORD_HASH } from "@/lib/app-domain/backup-coverage";

/// Reads the gzipped dump back out of the email the job just "sent".
/// This is the only place the Prisma-backed executor is exercised: the
/// round-trip test drives the same dump builder through plain `pg`, so
/// without this the app's actual query path would be untested.
function dumpFromLastEmail() {
  const [call] = vi.mocked(sendEmail).mock.calls;
  const attachment = (call[0].attachments ?? []).find((a) => a.filename.endsWith(".json.gz"));
  if (!attachment) throw new Error("no dump attached to the nightly email");
  return JSON.parse(gunzipSync(attachment.content as Buffer).toString("utf8"));
}

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "test-message-id" });
  vi.mocked(uploadFileToDriveFolder).mockReset();
  vi.mocked(uploadFileToDriveFolder).mockResolvedValue({ ok: true, fileId: "test-file-id" });
});

async function seedOneOfEach() {
  const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
  const client = await createTestClient({ name: "Backup Co" });
  const category = await createTestCategory({ clientId: client.id });
  await createTestTimeEntry({ userId: user.id, clientId: client.id, categoryId: category.id });
  return { user, client };
}

describe("sendNightlyDataExport()", () => {
  it("counts what is actually in the database", async () => {
    await seedOneOfEach();

    const result = await sendNightlyDataExport(new Date("2026-03-15T02:00:00Z"));

    expect(result.ok).toBe(true);
    expect(result.counts.clients).toBe(1);
    expect(result.counts.timeEntries).toBe(1);
  });

  it("leaves an archived client out of the export", async () => {
    const { client } = await seedOneOfEach();
    await prisma.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });

    const result = await sendNightlyDataExport(new Date("2026-03-15T02:00:00Z"));

    expect(result.counts.clients).toBe(0);
  });

  it("attaches both artefacts, named for the local date", async () => {
    await seedOneOfEach();

    await sendNightlyDataExport(new Date("2026-03-15T02:00:00Z"));

    const [call] = vi.mocked(sendEmail).mock.calls;
    const names = (call[0].attachments ?? []).map((a) => a.filename);
    expect(names).toHaveLength(2);
    // Israel is UTC+2 in March, so 02:00Z is still the 15th locally. A date computed in
    // UTC would be right here by luck; one computed a few hours earlier would not.
    expect(names.every((n) => n.includes("2026-03-15"))).toBe(true);
    expect(names.some((n) => n.endsWith(".xlsx"))).toBe(true);
    expect(names.some((n) => n.endsWith(".json.gz"))).toBe(true);
  });

  it("still sends the email when Google Drive fails", async () => {
    await seedOneOfEach();
    vi.mocked(uploadFileToDriveFolder).mockResolvedValue({ ok: false, error: "drive is down" });

    const result = await sendNightlyDataExport(new Date("2026-03-15T02:00:00Z"));

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.drive?.excel.ok).toBe(false);
    expect(result.drive?.dbDump.ok).toBe(false);
  });

  it("dumps every table the coverage map claims, with nothing to report", async () => {
    await seedOneOfEach();

    const result = await sendNightlyDataExport(new Date("2026-03-15T02:00:00Z"));

    const dump = dumpFromLastEmail();
    expect(dump.format).toBe(2);
    expect(Object.keys(dump.tables).sort()).toEqual(dumpedTables());
    // A problem here means the coverage map and the database disagree -
    // usually a table renamed on one side only.
    expect(dump.problems).toEqual([]);
    expect(dump.schemaMigration).toBeTruthy();
    expect(result.dump?.rows).toBeGreaterThan(0);
  });

  it("keeps a soft-deleted client out of the report and inside the dump", async () => {
    // The two artefacts answer different questions and this is the line
    // between them: the Excel report is what a person reads, so it hides
    // deleted rows; the dump is what a restore reads, and a live time
    // entry can still point at a deleted client. Dropping it there would
    // make the dump unrestorable.
    const { client } = await seedOneOfEach();
    await prisma.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });

    const result = await sendNightlyDataExport(new Date("2026-03-15T02:00:00Z"));

    expect(result.counts.clients).toBe(0);
    const dump = dumpFromLastEmail();
    const idIdx = dump.tables.clients.columns.indexOf("id");
    expect(dump.tables.clients.rows.map((r: unknown[]) => r[idIdx])).toContain(client.id);
  });

  it("never lets a password hash into the file", async () => {
    await seedOneOfEach();

    await sendNightlyDataExport(new Date("2026-03-15T02:00:00Z"));

    const dump = dumpFromLastEmail();
    const idx = dump.tables.users.columns.indexOf("passwordHash");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(dump.tables.users.rows.map((r: unknown[]) => r[idx])).toEqual(
      dump.tables.users.rows.map(() => REDACTED_PASSWORD_HASH)
    );
    // And not anywhere else in the file either.
    expect(JSON.stringify(dump)).not.toContain("$2");
  });

  it("records the delivery, so a night that did not run is visible afterwards", async () => {
    await seedOneOfEach();

    await sendNightlyDataExport(new Date("2026-03-15T02:00:00Z"));

    const deliveries = await prisma.emailDelivery.findMany();
    expect(deliveries).toHaveLength(1);
  });
});
