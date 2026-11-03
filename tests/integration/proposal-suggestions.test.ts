import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { approveWithSuggestion, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";

// 3.11.2026: a missing-field note offers a wording, and one press
// completes and approves the proposal. The wording is worked out on the
// server; the tool says what was sent incomplete.

async function setup() {
  const client = await createTestClient({ name: "Ankora פנימי" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  return { client, user };
}

const DOC = { kind: "TRANSCRIPT" as const, title: "נוהל רמות אישור", occurredAt: new Date("2026-11-03T00:00:00Z"), externalIds: ["ff-sugg"] };
const RULE = { knowledgeStatus: "CONFIRMED", kind: "APPROVAL_REQUIRED", title: "כניסה אוטומטית לתיק", statement: "הצעה נכנסת בלי אישור רק ברמה האוטומטית" };

describe("suggested wording for missing fields", () => {
  it("the tool lists what is incomplete, and one press completes and approves", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, { clientId: client.id, source: DOC, items: [{ target: "POLICY", reason: "נכתב בנוהל", payload: RULE }] });
    expect(r.proposed).toBe(1);
    expect(r.incomplete).toEqual([{ index: 0, missing: expect.stringContaining('בשדה "עד שיאושר"'), why: expect.stringContaining("בינתיים"), suggested: "כמו היום, עד שהכלל מאושר." }]);

    const [batch] = await listOpenBatches(user, { clientId: client.id });
    const [p] = batch.proposals;
    expect(p.flags).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SHAPE", block: true, fix: expect.objectContaining({ label: "כמו היום, עד שהכלל מאושר." }) })]));

    await approveWithSuggestion(user, p.id);
    const stored = await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(stored).toMatchObject({ state: "APPROVED", edited: true });
    expect((stored.payload as Record<string, unknown>).interimStatement).toBe("כמו היום, עד שהכלל מאושר.");
    const policy = await prisma.clientPolicy.findFirstOrThrow({ where: { clientId: client.id } });
    expect(policy.interimStatement).toBe("כמו היום, עד שהכלל מאושר.");
  });

  it("a card stored with the old sentence is said again with the wording", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, { clientId: client.id, source: DOC, items: [{ target: "POLICY", reason: "נכתב בנוהל", payload: RULE }] });
    const old = [{ code: "SHAPE", block: true, message: 'חסר כלל ביניים: מה עושים עד שהכלל מאושר. משלימים "עד שיאושר" בעריכה, או דוחים.' }];
    await prisma.knowledgeProposal.updateMany({ where: { batchId: r.batchId! }, data: { flags: old } });
    const [batch] = await listOpenBatches(user, { clientId: client.id });
    const flags = batch.proposals[0].flags as { message: string; fix?: unknown }[];
    expect(flags).toHaveLength(1);
    expect(flags[0].fix).toBeTruthy();
  });

  it("lists every note the card would show: the interim rule, and automated steps in one line", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: DOC,
      items: [
        { target: "POLICY", reason: "נכתב בנוהל", payload: RULE },
        { target: "PROCESS", reason: "נכתב בנוהל", payload: { knowledgeStatus: "CONFIRMED", title: "דוח חודשי", steps: [{ title: "שליפה", mode: "AUTOMATED" }, { title: "שמירה", mode: "AUTOMATED" }] } },
      ],
    });
    expect(r.incomplete.map((i) => i.index)).toEqual([0, 1]);
    expect(r.incomplete[1].missing).toContain("שלבים 1 ו-2 אוטומטיים");
    const [batch] = await listOpenBatches(user, { clientId: client.id });
    const cardNotes = batch.proposals.flatMap((p) => (p.flags as { code: string; message: string }[]).filter((f) => ["SHAPE", "R3"].includes(f.code)).map((f) => f.message));
    expect(r.incomplete.map((i) => i.missing).sort()).toEqual(cardNotes.sort());
  });

  it("without a wording for every problem, nothing is approved", async () => {
    const { client, user } = await setup();
    await proposeKnowledge(user, { clientId: client.id, source: DOC, items: [{ target: "FACT", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", kind: "TEMPORARY", body: "גישה זמנית" } }] });
    const [batch] = await listOpenBatches(user, { clientId: client.id });
    await expect(approveWithSuggestion(user, batch.proposals[0].id)).rejects.toThrow("אין להצעה הזו נוסח מוצע");
    expect(await prisma.knowledgeProposal.count({ where: { state: "PENDING" } })).toBe(1);
  });
});
