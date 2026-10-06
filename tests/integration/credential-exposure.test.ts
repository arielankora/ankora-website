import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { credentialExposureReport, exposureMessageFor } from "@/lib/app-domain/credential-exposure";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// DPA section 4 (7.10.2026): on leaving, each client gets the list of its
// logins the person revealed in the last 90 days. Built from the audit
// log alone, so these seed `credential.reveal` rows directly.

const DAY = 24 * 60 * 60_000;

async function credential(clientId: string, systemName: string, createdById: string, deleted = false) {
  return prisma.clientCredential.create({
    data: {
      id: `cred-${Math.random().toString(36).slice(2)}`,
      clientId,
      systemName,
      createdById,
      updatedById: createdById,
      deletedAt: deleted ? new Date() : null,
    },
  });
}

async function reveal(actorId: string, cred: { id: string; clientId: string }, at: Date) {
  await prisma.auditEvent.create({
    data: { actorId, action: "credential.reveal", entityType: "ClientCredential", entityId: cred.id, clientId: cred.clientId, createdAt: at },
  });
}

describe("credentialExposureReport", () => {
  it("groups by client, counts reveals, keeps deleted logins, and ignores older than 90 days", async () => {
    const now = new Date();
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: leaver } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const a = await createTestClient({ name: "א לקוח" });
    const b = await createTestClient({ name: "ב לקוח" });
    const bank = await credential(a.id, "בנק", admin.id);
    const btl = await credential(a.id, "ביטוח לאומי", admin.id, true);
    const old = await credential(b.id, "ישן", admin.id);

    await reveal(leaver.id, bank, new Date(now.getTime() - 2 * DAY));
    await reveal(leaver.id, bank, new Date(now.getTime() - 1 * DAY));
    await reveal(leaver.id, btl, new Date(now.getTime() - 10 * DAY));
    await reveal(leaver.id, old, new Date(now.getTime() - 91 * DAY));
    await reveal(admin.id, bank, new Date(now.getTime() - 1 * DAY));

    const report = await credentialExposureReport(admin, leaver.id, now);
    expect(report.clients).toHaveLength(1);
    expect(report.clients[0].clientName).toBe("א לקוח");
    const byName = Object.fromEntries(report.clients[0].items.map((i) => [i.systemName, i]));
    expect(byName["בנק"].revealCount).toBe(2);
    expect(byName["בנק"].lastRevealedAt.getTime()).toBe(now.getTime() - 1 * DAY);
    expect(byName["ביטוח לאומי"].deleted).toBe(true);

    const message = exposureMessageFor(report, report.clients[0]);
    expect(message).toContain("בנק");
    expect(message).not.toContain("ישן");

    expect(await prisma.auditEvent.count({ where: { action: "credential.exposure_report", entityId: leaver.id } })).toBe(1);
  });

  it("is for user managers only", async () => {
    const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(credentialExposureReport(manager, other.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
