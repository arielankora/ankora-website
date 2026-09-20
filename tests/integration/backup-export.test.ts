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

import { sendEmail } from "@/lib/email";
import { uploadFileToDriveFolder } from "@/lib/google-drive";
import { sendNightlyDataExport } from "@/lib/app-domain/backup-export";

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

  it("records the delivery, so a night that did not run is visible afterwards", async () => {
    await seedOneOfEach();

    await sendNightlyDataExport(new Date("2026-03-15T02:00:00Z"));

    const deliveries = await prisma.emailDelivery.findMany();
    expect(deliveries).toHaveLength(1);
  });
});
