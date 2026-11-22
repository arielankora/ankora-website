import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { listOpenBatches, proposeKnowledge, rejectProposal } from "@/lib/app-domain/knowledge-proposals";
import { reviewProposals } from "@/app/(product)/app/(authenticated)/knowledge/review-view";

// Weekly level-3 hunt, 22.11.2026: what the approvals screen sends to the
// browser for a sensitive proposal (R6) the viewer may not see.
//
// listOpenBatches blanks a hidden proposal's payload, reason and quote,
// and the card shows only "waiting for X". The rest of the row was spread
// as it was: the flags, computed from the full payload when the
// proposal arrived, and the approver's rejectReason. The batch goes to
// ReviewBatch, a client component, so whatever the proposal carries is
// serialized into the page (the approvals tab and the client's file tab),
// where anyone with access to the client can read it in the source.
//
// The MCP side (lib/mcp/approval-tools.ts, serializeProposal) already
// drops flags for a hidden proposal; the screen does not.
//
// Fixed in the same week: the hidden branch keeps only the R6 flag and
// drops the rejection reason. Each case first asserts that the proposal
// really is hidden from the viewer, so a change in who may see it cannot
// make it pass for the wrong reason.

const WHO = "דנה פרלמן";
const WHY_REJECTED = "כבר ידוע: אורן מאושפז עד סוף החודש";

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: h } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const hadas = await prisma.user.update({ where: { id: h.id }, data: { canApproveExceptions: true } });
  for (const u of [anna, hadas]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await addClientSource(anna, { clientId: client.id, kind: "TRANSCRIPT", title: "חפיפה" });
  return { client, anna, hadas };
}

async function propose(actorId: string, clientId: string) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  return proposeKnowledge(actor, {
    clientId,
    source: { kind: "TRANSCRIPT", title: "שיחה עם אורן", externalIds: [`ff-${Math.random()}`] },
    items: [
      // The person the sensitive fact is about is not in the file yet,
      // so the LINK flag names them.
      { target: "FACT", payload: { knowledgeStatus: "CONFIRMED", kind: "PREFERENCE", body: "מעדיפה שלא יתקשרו אליה בזמן הטיפולים", subjectName: WHO, sensitivity: "SENSITIVE" }, reason: "נאמר בשיחה" },
      // A second one keeps the batch open after the first is rejected.
      { target: "FACT", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "שגרה" }, reason: "נאמר בשיחה" },
    ],
  });
}

describe("a hidden sensitive proposal, as the review screen ships it", () => {
  it("does not name, in its flags, whom the item is about", async () => {
    const { client, anna, hadas } = await setup();
    const r = await propose(anna.id, client.id);

    const forHadas = (await listOpenBatches(hadas)).find((b) => b.id === r.batchId)!;
    expect(forHadas.proposals[0].hiddenFor).toBeNull();
    expect(JSON.stringify(forHadas.proposals[0].flags)).toContain(WHO);

    const batch = (await listOpenBatches(anna)).find((b) => b.id === r.batchId)!;
    expect(batch.proposals[0].hiddenFor).toBeTruthy();
    // Still marked sensitive, in R6's fixed words.
    expect((batch.proposals[0].flags as { code: string }[]).map((f) => f.code)).toEqual(["R6"]);
    // What ReviewBatch receives as props, i.e. what lands in the HTML.
    expect(JSON.stringify(reviewProposals(batch, () => ""))).not.toContain(WHO);
  });

  it("does not carry the approver's reason for rejecting it", async () => {
    const { client, anna, hadas } = await setup();
    const r = await propose(anna.id, client.id);
    const secretId = (await listOpenBatches(hadas)).find((b) => b.id === r.batchId)!.proposals[0].id;
    await rejectProposal(hadas, secretId, WHY_REJECTED);

    const batch = (await listOpenBatches(anna)).find((b) => b.id === r.batchId)!;
    const hidden = batch.proposals.find((p) => p.id === secretId)!;
    expect(hidden.hiddenFor).toBeTruthy();
    expect(JSON.stringify(reviewProposals(batch, () => ""))).not.toContain(WHY_REJECTED);
  });
});
