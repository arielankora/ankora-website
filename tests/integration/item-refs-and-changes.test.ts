import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientOrganization, updateClientOrganization } from "@/lib/app-domain/client-contacts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";

// Spec 3.1 and 5.2: refs to the team's other registers come in with a
// proposal; an organization changes like any other item; and "someone
// said otherwise" works on every item, not only a fact.

const S1 = [{ code: "S1" }];
const MEETING = { kind: "TRANSCRIPT" as const, title: "NUX weekly", occurredAt: new Date("2026-10-19T00:00:00Z"), externalIds: ["ff-gaps-a"] };

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "הדס" });
  return { client, user };
}

async function onlyProposal(user: Awaited<ReturnType<typeof setup>>["user"], batchId: string | null) {
  return (await listOpenBatches(user)).find((b) => b.id === batchId)!.proposals[0];
}

describe("refs and changes to items", () => {
  it("a proposal brings the team's refs into the item", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "ENTITY", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", name: "NUX Inc", externalRefs: ["RAID-002", "ClickUp:86c1x"] } }],
    });
    const id = (await approveProposal(user, (await onlyProposal(user, r.batchId)).id)).resultId!;
    const row = await prisma.clientEntity.findUniqueOrThrow({ where: { id } });
    expect(row.externalRefs).toEqual([
      { system: "RAID", id: "RAID-002" },
      { system: "ClickUp", id: "86c1x" },
    ]);
  });

  it("an organization is updated, and its name stays", async () => {
    const { client, user } = await setup();
    const org = await addClientOrganization(user, { clientId: client.id, name: "Nextage", role: "הנהלת חשבונות", sources: S1 });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "ORGANIZATION", action: "SUPERSEDE", targetId: org.id, reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", name: "Other", role: "הנהלת חשבונות ושכר" } }],
    });
    await approveProposal(user, (await onlyProposal(user, r.batchId)).id);
    const row = await prisma.clientOrganization.findUniqueOrThrow({ where: { id: org.id }, include: { organization: true } });
    expect(row.role).toBe("הנהלת חשבונות ושכר");
    expect(row.organization.name).toBe("Nextage");
  });

  it("refuses a domain that belongs to another organization", async () => {
    const { client, user } = await setup();
    await addClientOrganization(user, { clientId: client.id, name: "Mercury", domains: ["mercury.com"], sources: S1 });
    const org = await addClientOrganization(user, { clientId: client.id, name: "Nextage", sources: S1 });
    await expect(updateClientOrganization(user, org.id, { domains: ["mercury.com"] })).rejects.toThrow("Mercury");
  });

  it("a contradiction of a system leaves it uncertain, with what was said", async () => {
    const { client, user } = await setup();
    const sys = await addSystemAccess(user, { clientId: client.id, systemName: "Doka", accessStatus: "HAS_ACCESS", sources: S1 });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "SYSTEM", action: "CONTRADICT", targetId: sys.id, reason: "אמרו שאין גישה", payload: { knowledgeStatus: "UNCERTAIN", toResolve: "לבדוק", systemName: "Doka", accessStatus: "NO_ACCESS" } }],
    });
    const p = await onlyProposal(user, r.batchId);
    expect(p).toBeTruthy();
    await approveProposal(user, p.id);
    const row = await prisma.systemAccess.findUniqueOrThrow({ where: { id: sys.id } });
    expect(row.knowledgeStatus).toBe("UNCERTAIN");
    expect(row.accessStatus).toBe("HAS_ACCESS");
    expect(row.toResolve).toContain("נאמר אחרת: Doka");
  });
});
