import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientEntity } from "@/lib/app-domain/client-entities";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addProcess } from "@/lib/app-domain/processes";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";

// Claude names what is already in the file; approving links it (spec 3.5
// to 3.11). What is not in the file is flagged and left unlinked.

const S1 = [{ code: "S1" }];
const MEETING = { kind: "TRANSCRIPT" as const, title: "NUX weekly", occurredAt: new Date("2026-10-19T00:00:00Z"), externalIds: ["ff-links"] };

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.user.update({ where: { id: user.id }, data: { name: "הדס בדיקה" } });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "הדס" });
  const ltd = await addClientEntity(user, { clientId: client.id, name: "NUX.AI Ltd", sources: S1 });
  const inc = await addClientEntity(user, { clientId: client.id, name: "NUX Inc", sources: S1 });
  const ayala = await addClientContact(user, { clientId: client.id, name: "איילה מנצור", role: "מנהלת חשבונות", organizationName: "Nextage", relationship: "PROVIDER", sources: S1 });
  const doka = await addSystemAccess(user, { clientId: client.id, systemName: "Doka", sources: S1 });
  const p1 = await addProcess(user, { clientId: client.id, title: "תשלומי ספקים", sources: S1 });
  return { client, user, ltd, inc, ayala, doka, p1 };
}

type Flag = { code: string; message: string };
const flagsOf = (p: { flags: unknown }) => (Array.isArray(p.flags) ? (p.flags as Flag[]) : []);

async function proposals(user: Awaited<ReturnType<typeof setup>>["user"], batchId: string | null) {
  return (await listOpenBatches(user)).find((b) => b.id === batchId)!.proposals;
}

describe("names in a proposal", () => {
  it("link to the contacts, systems, entities and processes in the file when approved", async () => {
    const { client, user, ltd, inc, ayala, doka, p1 } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "REQUEST_TYPE", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", title: "חשבונית LTD", handling: "לאיילה", routeToNames: ["איילה מנצור"], processName: p1.code, entityName: "nux.ai ltd" } },
        {
          target: "PROCESS",
          reason: "נאמר",
          payload: {
            knowledgeStatus: "CONFIRMED",
            title: "תשלום חשבוניות",
            entityName: "NUX.AI Ltd",
            externalPartyNames: ["מנהלת חשבונות"],
            systemNames: ["Doka", "Mercury"],
            approverName: "הדס בדיקה",
            steps: [{ title: "להעלות ל-Doka", systemNames: ["Doka"] }],
          },
        },
        { target: "SYSTEM", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", systemName: "Notion", entityName: "NUX Inc", billingCycle: "ANNUAL", billingCostMinor: 120000, billingCurrency: "USD", cardLast4: "4242", invoiceTo: "billing-us@nux.ai" } },
        { target: "POLICY", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", kind: "SEPARATION", title: "הפרדה", statement: "לא מערבבים Inc ו-Ltd", params: { entityNames: ["NUX Inc", "NUX.AI Ltd"] } } },
        { target: "FACT", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", kind: "PREFERENCE", body: "מייל ולא וואטסאפ", subjectName: "איילה מנצור" } },
      ],
    });
    expect(r.proposed).toBe(5);
    const [rt, proc, sys, pol, fact] = await proposals(user, r.batchId);
    // Mercury is not in the file: said on the card, before anyone approves.
    expect(flagsOf(proc).filter((f) => f.code === "LINK")).toEqual([expect.objectContaining({ message: expect.stringContaining("Mercury") })]);
    expect(flagsOf(rt).some((f) => f.code === "LINK")).toBe(false);

    const rtRow = await prisma.requestType.findUniqueOrThrow({ where: { id: (await approveProposal(user, rt.id)).resultId! } });
    expect(rtRow).toMatchObject({ routeToContactIds: [ayala.id], processId: p1.id, entityId: ltd.id });

    const procRow = await prisma.process.findUniqueOrThrow({ where: { id: (await approveProposal(user, proc.id)).resultId! } });
    expect(procRow).toMatchObject({ entityId: ltd.id, externalPartyContactIds: [ayala.id], requiredSystemIds: [doka.id], approverUserId: user.id });
    const version = await prisma.processVersion.findFirstOrThrow({ where: { processId: procRow.id } });
    expect((version.steps as { systemIds?: string[] }[])[0].systemIds).toEqual([doka.id]);

    const sysRow = await prisma.systemAccess.findUniqueOrThrow({ where: { id: (await approveProposal(user, sys.id)).resultId! } });
    expect(sysRow).toMatchObject({ entityId: inc.id, billingCycle: "ANNUAL", billingCostMinor: 120000, billingCurrency: "USD", cardLast4: "4242", invoiceTo: "billing-us@nux.ai" });

    const polRow = await prisma.clientPolicy.findUniqueOrThrow({ where: { id: (await approveProposal(user, pol.id)).resultId! } });
    expect((polRow.params as { entityIds?: string[] }).entityIds?.sort()).toEqual([inc.id, ltd.id].sort());

    const factRow = await prisma.clientFact.findUniqueOrThrow({ where: { id: (await approveProposal(user, fact.id)).resultId! } });
    expect(factRow.subjectContactId).toBe(ayala.id);
  });

  it("finds what was approved earlier in the same batch", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "SYSTEM", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", systemName: "Mercury" } },
        { target: "PROCESS", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", title: "העברות בנק", systemNames: ["Mercury"] } },
      ],
    });
    const [sys, proc] = await proposals(user, r.batchId);
    expect(flagsOf(proc).some((f) => f.code === "LINK")).toBe(true);
    const sysId = (await approveProposal(user, sys.id)).resultId!;
    const procRow = await prisma.process.findUniqueOrThrow({ where: { id: (await approveProposal(user, proc.id)).resultId! } });
    expect(procRow.requiredSystemIds).toEqual([sysId]);
  });
});
