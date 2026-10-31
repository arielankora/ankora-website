import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientPolicy, approveClientPolicy } from "@/lib/app-domain/client-policies";
import { addProcess, saveProcessVersion } from "@/lib/app-domain/processes";
import { answerStrangerQuestion, recordStrangerTest, strangerPanel, strangerStates } from "@/lib/app-domain/stranger-tests";

// 31.10.2026, the stranger test. What is worth holding: a new test replaces
// what the last one left open; an answer goes into the file confirmed, with
// no proposal; a rule changes only on an explicit yes, and only by a
// manager or the client's account manager, and that yes is the approval.

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "Grantor" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: guy } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  for (const u of [anna, guy]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: anna.id } });
  await addClientSource(anna, { clientId: client.id, kind: "TRANSCRIPT", title: "חפיפה עם נדב" });
  const p = await addProcess(anna, { clientId: client.id, title: "גבייה", sources: S1 });
  await saveProcessVersion(anna, p.id, { steps: [{ title: "דרישת תשלום" }, { title: "חשבונית" }], baseVersion: 0 });
  return { client, anna, guy, ariel, p };
}

describe("stranger test", () => {
  it("records questions against the latest version, and a new test replaces what is still open", async () => {
    const { anna, p } = await setup();
    const first = await recordStrangerTest(anna, p.id, {
      summary: "זר לא יודע למי לשלוח",
      questions: [
        { step: 1, severity: "BLOCKER", askWho: "ANKORA", question: "באיזו תבנית?" },
        { severity: "SLOWS", askWho: "CLIENT", question: "מי אצל הלקוח מאשר?" },
      ],
    });
    expect(first.version).toBe(1);
    expect((await strangerStates([p.id])).get(p.id)).toMatchObject({ open: 2, blockers: 1, answered: 0 });
    await expect(recordStrangerTest(anna, p.id, { questions: [{ step: 3, severity: "BLOCKER", askWho: "ANKORA", question: "x" }] })).rejects.toThrow("שלב 3");

    await recordStrangerTest(anna, p.id, { questions: [{ step: 2, severity: "IMPROVES", askWho: "ANKORA", question: "איפה שומרים?" }] });
    const statuses = await prisma.processStrangerQuestion.findMany({ where: { testId: first.id }, select: { status: true } });
    expect(statuses.every((q) => q.status === "REPLACED")).toBe(true);
    const panel = (await strangerPanel([p.id])).get(p.id)!;
    expect(panel.state).toMatchObject({ open: 1, blockers: 0 });
    expect(panel.open.map((q) => q.question)).toEqual(["איפה שומרים?"]);
  });

  it("is closed to someone not on the client", async () => {
    const { p } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(recordStrangerTest(stranger, p.id, { questions: [] })).rejects.toThrow();
  });

  it("writes an answer into the file as a confirmed fact, with no proposal, under one source per test", async () => {
    const { client, guy, p } = await setup();
    const test = await recordStrangerTest(guy, p.id, {
      questions: [
        { step: 1, severity: "BLOCKER", askWho: "ANKORA", question: "באיזו תבנית?" },
        { step: 2, severity: "SLOWS", askWho: "CLIENT", question: "למי שולחים?" },
        { severity: "IMPROVES", askWho: "ANKORA", question: "יש SLA?" },
      ],
    });
    const [a, b, c] = test.questions;
    const r = await answerStrangerQuestion(guy, a.id, { answer: "התבנית בדרייב, תיקיית הצעות", kind: "LOCATION" });
    const fact = await prisma.clientFact.findUniqueOrThrow({ where: { id: r.factId! } });
    expect(fact).toMatchObject({ kind: "LOCATION", body: "P1 שלב 1: התבנית בדרייב, תיקיית הצעות", knowledgeStatus: "CONFIRMED" });
    const source = await prisma.clientSource.findFirstOrThrow({ where: { clientId: client.id, code: (fact.sources as { code: string }[])[0].code } });
    expect(source.kind).toBe("PERSON");
    expect(await prisma.knowledgeProposal.count({ where: { clientId: client.id } })).toBe(0);

    await answerStrangerQuestion(guy, b.id, { answer: "לנדב בוואטסאפ", toldBy: "נדב" });
    const sources = await prisma.clientSource.findMany({ where: { clientId: client.id, kind: "PERSON" } });
    expect(sources).toHaveLength(1);
    expect(sources[0].participants).toContain("נדב");

    await answerStrangerQuestion(guy, c.id, { notRelevant: true });
    await expect(answerStrangerQuestion(guy, c.id, { answer: "x" })).rejects.toThrow("נסגרה");
    expect((await strangerStates([p.id])).get(p.id)).toMatchObject({ open: 0, answered: 2 });
  });

  it("changes a rule only on a yes, by a manager or the account manager, and the yes approves it", async () => {
    const { client, anna, guy, p } = await setup();
    const rule = await addClientPolicy(anna, { clientId: client.id, kind: "APPROVAL_REQUIRED", title: "הצעת מחיר", statement: "כל הצעה עוברת לנדב", interimStatement: "כל הצעה עוברת לנדב", sources: S1 });
    await approveClientPolicy(anna, rule.id); // the account manager approves a rule (31.10.2026)
    const test = await recordStrangerTest(anna, p.id, {
      questions: [
        { step: 1, severity: "BLOCKER", askWho: "ANKORA", question: "כל הצעה לנדב?" },
        { step: 1, severity: "SLOWS", askWho: "ANKORA", question: "גם מתחת ל-5,000?" },
      ],
    });
    const [q1, q2] = test.questions;
    const change = { policyId: rule.id, statement: "הצעה מעל 5,000 ש\"ח עוברת לנדב" };

    await expect(answerStrangerQuestion(anna, q1.id, { answer: "רק מעל 5,000", ruleChange: { ...change, userConfirmed: false } })).rejects.toThrow("אתה מאשר");
    await expect(answerStrangerQuestion(guy, q1.id, { answer: "רק מעל 5,000", ruleChange: { ...change, userConfirmed: true } })).rejects.toThrow("מנהל התיק");

    const r = await answerStrangerQuestion(anna, q1.id, { answer: "רק מעל 5,000", ruleChange: { ...change, userConfirmed: true } });
    expect(r.policyId).toBe(rule.id);
    const after = await prisma.clientPolicy.findUniqueOrThrow({ where: { id: rule.id } });
    expect(after).toMatchObject({ status: "ACTIVE", statement: change.statement, version: rule.version + 1, approvedById: anna.id });

    // Someone who may not change rules still has the answer recorded.
    const plain = await answerStrangerQuestion(guy, q2.id, { answer: "מתחת ל-5,000 לא צריך" });
    expect(plain.factId).toBeTruthy();
  });

  it("an employee who is not the account manager does not approve a rule", async () => {
    const { client, anna, guy } = await setup();
    const rule = await addClientPolicy(anna, { clientId: client.id, kind: "APPROVAL_REQUIRED", title: "x", statement: "y", interimStatement: "z", sources: S1 });
    await expect(approveClientPolicy(guy, rule.id)).rejects.toThrow("מנהל התיק");
  });
});
