import { describe, expect, it } from "vitest";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addProcess } from "@/lib/app-domain/processes";
import { proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";
import { brainMetrics } from "@/lib/app-domain/brain-metrics";

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
    expect(m.noBackup.value).toBe(1);
    expect(m.withAnkora.value).toBe(0);
    expect(m.oldestProposal.value).toBe(0);
  });
});
