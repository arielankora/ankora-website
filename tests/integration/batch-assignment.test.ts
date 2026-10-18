import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { countPendingProposals, listOpenBatches } from "@/lib/app-domain/knowledge-proposals";
import { assignBatch, discardAwaiting, listAwaitingAssignment, proposeAwaitingAssignment } from "@/lib/app-domain/batch-assignment";

// "ממתין לשיוך" (claude/org-brain-spec-2026-10-12.md, 5.1, step 3).
//
// What is worth holding here: a meeting whose client is not clear is in
// no file and no register until a person picks; only someone who may see
// every candidate sees it; picking proposes it as if sent there; picking
// another client carries nothing that pointed into the proposed one's file;
// and a secret is never stored, not even while it waits.

async function setup() {
  const nux = await createTestClient({ name: "NUX" });
  const other = await createTestClient({ name: "Zest" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.createMany({ data: [{ userId: user.id, clientId: nux.id }, { userId: user.id, clientId: other.id }] });
  return { nux, other, user };
}

const MEETING = { title: "Nextage weekly", occurredAt: new Date("2026-10-16T00:00:00Z"), participants: ["שני הלוי"], externalIds: ["ff-777"] };

describe("batch waiting for its client", () => {
  it("waits in no file, then goes to the client a person picks as an ordinary batch", async () => {
    const { nux, other, user } = await setup();
    const sent = await proposeAwaitingAssignment(user, {
      proposedClientId: nux.id,
      candidateClientIds: [nux.id, other.id],
      reason: "הדיון היה על דוחות Justworks, ורק ל-NUX יש",
      source: MEETING,
      items: [
        { target: "FACT", payload: { kind: "NOTE", body: "הדוח הרבעוני נשלח עד ה-15" }, at: "03:10" },
        { target: "FACT", payload: { kind: "NOTE", body: "קוד הכניסה 4417", }, reason: "password: Hunter2pass!" },
      ],
    });
    expect(sent.waiting).toBe(1);
    expect(sent.dropped).toHaveLength(1);
    expect(sent.secretTaskId).not.toBeNull();
    // Nothing in any register, nothing to review, and it counts once.
    expect(await prisma.clientSource.count({ where: { clientId: { in: [nux.id, other.id] } } })).toBe(0);
    expect(await listOpenBatches(user)).toHaveLength(0);
    expect(await countPendingProposals(user)).toBe(1);
    expect(await countPendingProposals(user, nux.id)).toBe(0);
    // The dropped text is nowhere.
    expect(JSON.stringify(await prisma.knowledgeBatch.findUniqueOrThrow({ where: { id: sent.batchId! } }))).not.toContain("Hunter2");

    const [waiting] = await listAwaitingAssignment(user);
    expect(waiting).toMatchObject({ proposedClientId: nux.id, reason: expect.stringContaining("Justworks"), items: [expect.stringContaining("הדוח הרבעוני")] });
    expect(waiting.candidates.map((c) => c.name).sort()).toEqual(["NUX", "Zest"]);

    // The same recording again, while it waits.
    await expect(proposeAwaitingAssignment(user, { proposedClientId: nux.id, candidateClientIds: [nux.id, other.id], reason: "שוב", source: MEETING, items: [{ target: "FACT", payload: { kind: "NOTE", body: "x" } }] })).rejects.toThrow("כבר ממתינה");

    const assigned = await assignBatch(user, sent.batchId!, nux.id);
    expect(assigned).toMatchObject({ clientId: nux.id, sourceCode: "S1", proposed: 1 });
    // The secret's task was opened when it arrived; not a second one now.
    expect(assigned.secretTaskId).toBeNull();
    expect(assigned.dropped).toEqual([{ index: 1, reason: expect.stringContaining("לא נשמר") }]);
    const [batch] = await listOpenBatches(user, { clientId: nux.id });
    expect(batch.createdById).toBe(user.id);
    expect(batch.proposals[0].payload).toMatchObject({ sources: [{ code: "S1", at: "03:10" }] });
    expect(await prisma.knowledgeBatch.count({ where: { id: sent.batchId! } })).toBe(0);
    await expect(assignBatch(user, sent.batchId!, nux.id)).rejects.toThrow("כבר שויכה");

    // Now it is registered: sending it again as uncertain is refused.
    await expect(proposeAwaitingAssignment(user, { proposedClientId: other.id, candidateClientIds: [nux.id, other.id], reason: "שוב", source: MEETING, items: [{ target: "FACT", payload: { kind: "NOTE", body: "x" } }] })).rejects.toThrow("כבר רשומה אצל NUX");
  });

  it("to another client, a change to a fact of the proposed client does not travel", async () => {
    const { nux, other, user } = await setup();
    const fact = await prisma.clientFact.create({ data: { clientId: nux.id, kind: "NOTE", body: "הדוח נשלח עד ה-10" } });
    const sent = await proposeAwaitingAssignment(user, {
      proposedClientId: nux.id,
      candidateClientIds: [nux.id, other.id],
      reason: "נשמע כמו NUX",
      source: { ...MEETING, externalIds: ["ff-778"] },
      items: [
        { target: "FACT", payload: { kind: "NOTE", body: "חדש" }, alsoSources: ["S4"] },
        { target: "FACT", action: "SUPERSEDE", targetId: fact.id, payload: { kind: "NOTE", body: "הדוח נשלח עד ה-15" } },
      ],
    });
    const assigned = await assignBatch(user, sent.batchId!, other.id);
    expect(assigned).toMatchObject({ clientId: other.id, proposed: 1 });
    expect(assigned.dropped).toEqual([{ index: 1, reason: expect.stringContaining("לקוח אחר") }]);
    const [batch] = await listOpenBatches(user, { clientId: other.id });
    expect(batch.proposals[0].payload).toMatchObject({ sources: [{ code: "S1" }] });
    expect(await prisma.clientSource.count({ where: { clientId: nux.id } })).toBe(0);
  });

  it("is seen only by someone with every candidate, and can be removed with a line", async () => {
    const { nux, other, user } = await setup();
    const { user: onlyNux } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.userClientAccess.create({ data: { userId: onlyNux.id, clientId: nux.id } });
    const sent = await proposeAwaitingAssignment(user, {
      proposedClientId: other.id,
      candidateClientIds: [nux.id, other.id],
      reason: "הכותרת",
      source: { ...MEETING, externalIds: [] },
      items: [{ target: "FACT", payload: { kind: "NOTE", body: "משהו" } }],
    });
    expect(await listAwaitingAssignment(onlyNux)).toHaveLength(0);
    expect(await countPendingProposals(onlyNux)).toBe(0);
    await expect(assignBatch(onlyNux, sent.batchId!, nux.id)).rejects.toThrow();
    // Someone who cannot see a candidate cannot send it to one either.
    await expect(proposeAwaitingAssignment(onlyNux, { proposedClientId: nux.id, candidateClientIds: [nux.id, other.id], reason: "x", source: MEETING, items: [{ target: "FACT", payload: { kind: "NOTE", body: "x" } }] })).rejects.toThrow();

    await expect(discardAwaiting(user, sent.batchId!, " ")).rejects.toThrow("בשורה אחת");
    await discardAwaiting(user, sent.batchId!, "שיחה של הספק עם לקוח אחר שלו");
    expect(await listAwaitingAssignment(user)).toHaveLength(0);
    expect(await prisma.auditEvent.count({ where: { action: "knowledge_batch.discard" } })).toBe(1);
  });
});
