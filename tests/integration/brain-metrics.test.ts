import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addProcess } from "@/lib/app-domain/processes";
import { proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";
import { brainMetrics, sendWeeklyBrainMetrics } from "@/lib/app-domain/brain-metrics";

const sent: { to: string[]; subject: string; text: string }[] = [];
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async (m: { to: string[]; subject: string; text: string }) => {
    sent.push(m);
    return { ok: true };
  }),
}));
beforeEach(() => {
  sent.length = 0;
});

// Spec section 11, read from what the product records, for managers only.

describe("brain metrics", () => {
  it("reads every client's file, and only a manager may see it", async () => {
    const client = await createTestClient({ name: "NUX metrics" });
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await addClientSource(admin, { clientId: client.id, kind: "PERSON", title: "הדס" });
    await addSystemAccess(admin, { clientId: client.id, systemName: "Doka", accessStatus: "PENDING", sources: [{ code: "S1" }] });
    await addProcess(admin, { clientId: client.id, title: "תשלומי ספקים", transitionStatus: "IN_HANDOVER", sources: [{ code: "S1" }] });
    await proposeKnowledge(admin, { clientId: client.id, source: { code: "S1" }, items: [{ target: "FACT", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "x" } }] });

    await expect(brainMetrics(employee)).rejects.toThrow("מנהלים");
    const r = await brainMetrics(admin);
    const row = r.clients.find((c) => c.clientId === client.id)!;
    const m = Object.fromEntries(row.measures.map((x) => [x.key, x]));
    expect(m.noAccess.value).toBe(1);
    expect(m.noBackup).toBeUndefined();
    expect(m.withAnkora.value).toBe(0);
    expect(m.oldestProposal.value).toBe(0);
  });

  it("emails the admins once a week, on Sunday only", async () => {
    await createTestClient({ name: "Weekly" });
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const sunday = new Date("2026-10-25T06:00:00Z");
    expect(await sendWeeklyBrainMetrics(new Date("2026-10-26T06:00:00Z"))).toMatchObject({ sent: 0, skipped: "not Sunday" });
    await sendWeeklyBrainMetrics(sunday);
    const mine = sent.filter((m) => m.to.includes(admin.email));
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toContain("מדדי התיק, שבוע 25.10.2026");
    expect(mine[0].text).toContain("שלמות תהליכים");
    // A second run the same day sends nothing new.
    sent.length = 0;
    await sendWeeklyBrainMetrics(sunday);
    expect(sent.filter((m) => m.to.includes(admin.email))).toHaveLength(0);
    expect(await prisma.auditEvent.count({ where: { action: "brain_metrics.weekly_email", entityId: admin.id } })).toBe(1);
  });
});
