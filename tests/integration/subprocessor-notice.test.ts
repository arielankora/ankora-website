import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { updateClient } from "@/lib/app-domain/clients";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { SUBPROCESSOR_NOTICE_SOURCE_REQUIRED } from "@/lib/subprocessor-notice";

// Client.subprocessorNotice (3.11.2026), through the same updateClient the
// client settings form calls. What matters: a new client starts unchecked,
// a yes or a no needs a source, who and when are stamped only when the
// answer moves, and each change has its own audit line.

async function seedDocument(clientId: string) {
  return prisma.clientDocument.create({
    data: {
      clientId,
      title: "הסכם שירות",
      kind: "CONTRACT",
      driveFileId: `drive-${Math.random().toString(36).slice(2)}`,
      mimeType: "application/pdf",
      clientVisible: false,
    },
  });
}

describe("updateClient(): sub-processor notice", () => {
  it("starts unchecked", async () => {
    const client = await createTestClient();
    const row = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(row.subprocessorNotice).toBe("UNCHECKED");
    expect(row.subprocessorNoticeCheckedAt).toBeNull();
  });

  it("records the answer, its source and contract, who checked, and one audit line", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    const doc = await seedDocument(client.id);

    await updateClient(admin, client.id, {
      subprocessorNotice: { notice: "COMMITTED", source: "הסכם שירות, סעיף 9", documentId: doc.id },
    });

    const row = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(row.subprocessorNotice).toBe("COMMITTED");
    expect(row.subprocessorNoticeSource).toBe("הסכם שירות, סעיף 9");
    expect(row.subprocessorNoticeDocumentId).toBe(doc.id);
    expect(row.subprocessorNoticeCheckedById).toBe(admin.id);
    expect(row.subprocessorNoticeCheckedAt).not.toBeNull();
    expect(
      await prisma.auditEvent.count({ where: { entityId: client.id, action: "client.subprocessor_notice" } })
    ).toBe(1);
  });

  it("does not restamp or log when the answer did not move", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    await updateClient(admin, client.id, { subprocessorNotice: { notice: "NOT_COMMITTED", source: "הסכם, סעיף 4" } });
    const first = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });

    await updateClient(admin, client.id, {
      timezone: "Asia/Jerusalem",
      subprocessorNotice: { notice: "NOT_COMMITTED", source: "הסכם, סעיף 4" },
    });

    const second = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(second.subprocessorNoticeCheckedAt).toEqual(first.subprocessorNoticeCheckedAt);
    expect(
      await prisma.auditEvent.count({ where: { entityId: client.id, action: "client.subprocessor_notice" } })
    ).toBe(1);
  });

  it("refuses a yes without a source, and saves nothing else either", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient({ name: "לפני" });

    await expect(
      updateClient(admin, client.id, { name: "אחרי", subprocessorNotice: { notice: "COMMITTED", source: "" } })
    ).rejects.toThrow(SUBPROCESSOR_NOTICE_SOURCE_REQUIRED);

    const row = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(row.name).toBe("לפני");
    expect(row.subprocessorNotice).toBe("UNCHECKED");
  });

  it("refuses a contract filed on another client", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    const other = await createTestClient();
    const foreign = await seedDocument(other.id);

    await expect(
      updateClient(admin, client.id, {
        subprocessorNotice: { notice: "COMMITTED", source: "סעיף 9", documentId: foreign.id },
      })
    ).rejects.toThrow("החוזה שנבחר לא נמצא בתיק של הלקוח הזה.");
  });

  it("is a manager's change: an employee is refused", async () => {
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await createTestClient();

    await expect(
      updateClient(employee, client.id, { subprocessorNotice: { notice: "COMMITTED", source: "סעיף 9" } })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
