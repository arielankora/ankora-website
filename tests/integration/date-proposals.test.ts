import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess } from "@/lib/app-domain/processes";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";

// Spec 3.10 and 3.1: a date proposed by Claude enters the dates, linked to
// its process; an item nobody named an owner for is the account manager's.

const MEETING = { kind: "TRANSCRIPT" as const, title: "שכר", occurredAt: new Date("2026-10-19T00:00:00Z"), externalIds: ["ff-dates"] };

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: manager } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.user.update({ where: { id: manager.id }, data: { name: "הדס מנהלת" } });
  await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: manager.id } });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "דקלה" });
  return { client, user, manager };
}

async function proposals(user: Awaited<ReturnType<typeof setup>>["user"], batchId: string | null) {
  return (await listOpenBatches(user)).find((b) => b.id === batchId)!.proposals;
}

describe("dates from proposals", () => {
  it("a monthly date enters the dates, scheduled and linked to its process", async () => {
    const { client, user, manager } = await setup();
    const p = await addProcess(user, { clientId: client.id, title: "שכר חודשי", sources: [{ code: "S1" }] });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "DATE", reason: "דקלה אמרה", payload: { title: "טבלת השכר לדקלה", recurrence: "MONTHLY", dayOfMonth: 1, processName: p.code, responsibleName: "הדס מנהלת", taskDaysBefore: 2 } }],
    });
    expect(r.proposed).toBe(1);
    const [prop] = await proposals(user, r.batchId);
    const id = (await approveProposal(user, prop.id)).resultId!;
    const d = await prisma.importantDate.findUniqueOrThrow({ where: { id }, include: { reminderRules: true } });
    expect(d).toMatchObject({ clientId: client.id, recurrence: "MONTHLY", day: 1, processId: p.id, responsibleUserId: manager.id, createAutoTask: true, autoTaskLeadDays: 2 });
    expect(d.nextOccurrenceAt).not.toBeNull();
  });

  it("refuses a date with no day, on the card", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, { clientId: client.id, source: MEETING, items: [{ target: "DATE", reason: "נאמר", payload: { title: "שכר", recurrence: "MONTHLY" } }] });
    const [prop] = await proposals(user, r.batchId);
    expect((prop.flags as { code: string; block?: boolean }[]).some((f) => f.code === "SHAPE" && f.block)).toBe(true);
  });

  it("a new item with no owner named is the account manager's", async () => {
    const { client, user, manager } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "FACT", reason: "נאמר", payload: { kind: "NOTE", body: "9 עובדים בישראל", knowledgeStatus: "CONFIRMED" } }],
    });
    const [prop] = await proposals(user, r.batchId);
    const fact = await prisma.clientFact.findUniqueOrThrow({ where: { id: (await approveProposal(user, prop.id)).resultId! } });
    expect(fact.ownerId).toBe(manager.id);
  });
});
