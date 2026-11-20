import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientFact, supersedeClientFact, undoFactSupersede } from "@/lib/app-domain/client-facts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";

// 20.11.2026 (Ariel): two meetings proposed a new version of the same fact.
// One was approved; the other stayed on the approvals screen, and approving
// it failed with "הפריט כבר הוחלף". A proposal now follows the fact to the
// version in force: it closes when that version already says it, and
// otherwise compares with it and is approved on it.

async function setup() {
  const client = await createTestClient({ name: "מאיה" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "x" }); // S1
  const fact = await addClientFact(user, { clientId: client.id, kind: "NOTE", body: "חשבוניות יוצאות דרך MAK", sources: [{ code: "S1" }] });
  return { client, user, fact };
}

async function propose(user: Parameters<typeof proposeKnowledge>[0], clientId: string, title: string, targetId: string, body: string) {
  const kind = (await prisma.clientFact.findUniqueOrThrow({ where: { id: targetId } })).kind;
  const r = await proposeKnowledge(user, {
    clientId,
    source: { kind: "TRANSCRIPT", title, occurredAt: new Date("2026-11-18T00:00:00Z"), externalIds: [title] },
    items: [{ target: "FACT", reason: "נאמר בפגישה", action: "SUPERSEDE", targetId, payload: { knowledgeStatus: "CONFIRMED", kind, body }, at: "01:00" }],
  });
  return (await prisma.knowledgeProposal.findFirstOrThrow({ where: { batchId: r.batchId! } })).id;
}

const LONG = "חשבוניות יוצאות דרך MAK, וללקוח חו\"ל דרך העוסק של השותפה";

describe("a proposal on a fact replaced since", () => {
  it("closes as already in the file when the version in force says it, with its source", async () => {
    const { client, user, fact } = await setup();
    const first = await propose(user, client.id, "פגישה 1", fact.id, LONG);
    const second = await propose(user, client.id, "פגישה 2", fact.id, LONG);
    const { resultId } = await approveProposal(user, first);
    const closed = await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: second } });
    expect(closed).toMatchObject({ state: "APPROVED", attached: true, resultId, targetId: resultId });
    const live = await prisma.clientFact.findUniqueOrThrow({ where: { id: resultId! } });
    expect((live.sources as { code: string }[]).map((s) => s.code)).toEqual(expect.arrayContaining(["S2", "S3"]));
  });

  it("moves to the version in force when it says something else, shows the change from it, and is approved on it", async () => {
    const { client, user, fact } = await setup();
    const first = await propose(user, client.id, "פגישה 1", fact.id, LONG);
    const second = await propose(user, client.id, "פגישה 2", fact.id, "חשבוניות יוצאות דרך MAK בין 10 ל-20 בחודש");
    const { resultId } = await approveProposal(user, first);
    expect((await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: second } })).targetId).toBe(resultId);

    const card = (await listOpenBatches(user, { clientId: client.id })).flatMap((b) => b.proposals).find((p) => p.id === second)!;
    expect(card.existing?.body).toBe(LONG);
    expect(card.changes?.map((c) => c.field)).toEqual(["body"]);

    const approved = await approveProposal(user, second);
    expect(await prisma.clientFact.findUniqueOrThrow({ where: { id: approved.resultId! } })).toMatchObject({ body: "חשבוניות יוצאות דרך MAK בין 10 ל-20 בחודש", knowledgeStatus: "CONFIRMED" });
    expect((await prisma.clientFact.findUniqueOrThrow({ where: { id: resultId! } })).knowledgeStatus).toBe("SUPERSEDED");
  });

  it("a proposal left on a replaced version before this fix is approved on the version in force", async () => {
    const { client, user, fact } = await setup();
    const stale = await propose(user, client.id, "פגישה 1", fact.id, "חשבוניות יוצאות דרך MAK בין 10 ל-20 בחודש");
    // Replaced the way it was before: nothing moved the proposal.
    const newer = await supersedeClientFact(user, fact.id, { kind: "NOTE", body: LONG, sources: [{ code: "S1" }] });
    const card = (await listOpenBatches(user, { clientId: client.id })).flatMap((b) => b.proposals).find((p) => p.id === stale)!;
    expect(card.existing?.body).toBe(LONG);
    expect(card.changes?.map((c) => c.field)).toEqual(["body"]);
    const approved = await approveProposal(user, stale);
    expect(await prisma.clientFact.findUniqueOrThrow({ where: { id: approved.resultId! } })).toMatchObject({ body: "חשבוניות יוצאות דרך MAK בין 10 ל-20 בחודש" });
    expect((await prisma.clientFact.findUniqueOrThrow({ where: { id: newer.id } })).knowledgeStatus).toBe("SUPERSEDED");
  });

  it("undoing the replacement sends a moved proposal back to the version restored", async () => {
    const { client, user, fact } = await setup();
    const first = await propose(user, client.id, "פגישה 1", fact.id, LONG);
    const second = await propose(user, client.id, "פגישה 2", fact.id, "משהו אחר לגמרי");
    await approveProposal(user, first);
    await undoFactSupersede(user, fact.id, "CONFIRMED");
    expect((await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: second } })).targetId).toBe(fact.id);
  });

  // 20.11.2026: a new text for a temporary fact stopped at "מידע זמני צריך
  // תוקף", though the fact in the file had one. The new version keeps it.
  it("a new version of a temporary fact keeps its end, and is not held for it", async () => {
    const { client, user } = await setup();
    const temp = await addClientFact(user, { clientId: client.id, kind: "TEMPORARY", body: "חסימת וואטסאפ", validUntilEvent: "עד שהאימות עובר", sources: [{ code: "S1" }] });
    const id = await propose(user, client.id, "פגישה 1", temp.id, "חסימת וואטסאפ, ניסיון נוסף ב-19.11");
    const card = (await listOpenBatches(user, { clientId: client.id })).flatMap((b) => b.proposals).find((p) => p.id === id)!;
    expect(((card.flags ?? []) as { code: string }[]).map((f) => f.code)).not.toContain("SHAPE");
    const { resultId } = await approveProposal(user, id);
    expect(await prisma.clientFact.findUniqueOrThrow({ where: { id: resultId! } })).toMatchObject({ kind: "TEMPORARY", body: "חסימת וואטסאפ, ניסיון נוסף ב-19.11", validUntilEvent: "עד שהאימות עובר" });
  });
});

