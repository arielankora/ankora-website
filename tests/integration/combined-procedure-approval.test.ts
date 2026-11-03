import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";
import { addProcess, saveProcessVersion } from "@/lib/app-domain/processes";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { decideProposalForAi } from "@/lib/app-domain/mcp-approvals";
import { processProposalFlagMessage } from "@/lib/procedure-approval";

// One approval for a process proposal (3.11.2026). Whoever approves the
// client's procedures approves, with the proposal, the procedure version it
// brought, when that version passes every check. A procedure that fails a
// check, a person who does not approve procedures, a client with
// separation, and the server approving on arrival: as before, a draft.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  for (const u of [hadas, ariel]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "שיחת קליטה" });
  return { client, hadas, ariel };
}

const MEETING = { kind: "TRANSCRIPT" as const, title: "NUX & Ankora", occurredAt: new Date("2026-11-03T00:00:00Z"), externalIds: ["ff-combined"] };
const S1 = [{ code: "S1" }];

const GOOD_STEPS = [
  { title: "מעלים ל-Doka", actionTags: ["INVOICE"] },
  { title: "מורשה חתימה חותם", actionTags: ["BANK_SIGNATURE"], requiresApproval: true },
];
// A payment Claude prepares with nobody approving it: R1 blocks.
const BLOCKED_STEPS = [{ title: "מייל מרוכז לאיילה", mode: "ASSISTED", actionTags: ["PAYMENT"], requiresApproval: false }];

async function proposeProcess(actor: Parameters<typeof proposeKnowledge>[0], clientId: string, steps: unknown[], extra: { action?: "SUPERSEDE"; targetId?: string } = {}) {
  const r = await proposeKnowledge(actor, {
    clientId,
    source: MEETING,
    items: [{ target: "PROCESS", reason: "נאמר בפגישה", ...extra, payload: { knowledgeStatus: "CONFIRMED", title: "תשלומי ספקים LTD", triggerKinds: ["SCHEDULED"], triggerText: "ב-10 וב-25", steps } }],
  });
  const batch = (await listOpenBatches(actor, { clientId })).find((b) => b.id === r.batchId)!;
  return { batch, proposal: batch.proposals.find((p) => p.target === "PROCESS")! };
}

async function processOf(id: string) {
  return prisma.process.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { version: "asc" } } } });
}

describe("one approval for a process proposal and its procedure", () => {
  it("a manager approving a process whose procedure passes approves the procedure too: the process is active", async () => {
    const { client, ariel } = await setup();
    const { batch, proposal } = await proposeProcess(ariel, client.id, GOOD_STEPS);
    expect(batch.procedureMode).toBe("combined");
    expect((proposal.flags as { code: string; message: string }[]).find((f) => f.code === "PROCESS")?.message).toBe(processProposalFlagMessage("combined"));

    const approved = await approveProposal(ariel, proposal.id);
    expect(approved.procedure).toEqual({ approved: true, version: 1 });
    const process = await processOf(approved.resultId!);
    expect(process.status).toBe("ACTIVE");
    expect(process.versions.map((v) => [v.version, v.status, v.approvedById])).toEqual([[1, "APPROVED", ariel.id]]);
    expect(await prisma.auditEvent.count({ where: { action: "process.version_approve", entityId: process.id } })).toBe(1);
  });

  it("a procedure that fails a check stays a draft, and the approval says what to fix", async () => {
    const { client, ariel } = await setup();
    const { proposal } = await proposeProcess(ariel, client.id, BLOCKED_STEPS);
    const approved = await approveProposal(ariel, proposal.id);
    expect(approved.state).toBe("APPROVED");
    expect(approved.procedure).toMatchObject({ approved: false });
    expect(approved.procedure && !approved.procedure.approved && approved.procedure.reason).toContain("לא עובר את הבדיקות");
    const process = await processOf(approved.resultId!);
    expect(process.status).toBe("DRAFT");
    expect(process.versions.map((v) => [v.version, v.status])).toEqual([[1, "DRAFT"]]);
  });

  it("someone who does not approve procedures approves the proposal only, as before", async () => {
    const { client, hadas } = await setup();
    const { batch, proposal } = await proposeProcess(hadas, client.id, GOOD_STEPS);
    expect(batch.procedureMode).toBe("draft");
    const approved = await approveProposal(hadas, proposal.id);
    expect(approved.procedure).toBeNull();
    const process = await processOf(approved.resultId!);
    expect(process.status).toBe("DRAFT");
    expect(process.versions.map((v) => v.status)).toEqual(["DRAFT"]);
  });

  it("the client's account manager approves both, as they approve procedures", async () => {
    const { client, hadas } = await setup();
    await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: hadas.id } });
    const { proposal } = await proposeProcess(hadas, client.id, GOOD_STEPS);
    const approved = await approveProposal(hadas, proposal.id);
    expect(approved.procedure).toEqual({ approved: true, version: 1 });
    expect((await processOf(approved.resultId!)).status).toBe("ACTIVE");
  });

  it("with the client's separation on, the procedure waits for someone else, and the card says so", async () => {
    const { client, ariel } = await setup();
    await prisma.client.update({ where: { id: client.id }, data: { procedureApprovalSeparation: true } });
    const { batch, proposal } = await proposeProcess(ariel, client.id, GOOD_STEPS);
    expect(batch.procedureMode).toBe("separation");
    const approved = await approveProposal(ariel, proposal.id);
    expect(approved.procedure).toMatchObject({ approved: false });
    expect((await processOf(approved.resultId!)).versions.map((v) => v.status)).toEqual(["DRAFT"]);
  });

  it("a change to a process approves only the version it brought, beside the one in force", async () => {
    const { client, hadas, ariel } = await setup();
    const p = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים LTD", sources: S1 });
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "מעלים ל-Doka" }], baseVersion: 0 });
    // An old draft by someone else is not approved by the way: the change
    // brings its own version, the latest.
    const { proposal } = await proposeProcess(ariel, client.id, GOOD_STEPS, { action: "SUPERSEDE", targetId: p.id });
    const approved = await approveProposal(ariel, proposal.id);
    expect(approved.procedure).toEqual({ approved: true, version: 2 });
    expect((await processOf(p.id)).versions.map((v) => [v.version, v.status])).toEqual([
      [1, "DRAFT"],
      [2, "APPROVED"],
    ]);
  });

  it("a change that brings no procedure leaves a draft by someone else alone", async () => {
    const { client, hadas, ariel } = await setup();
    const p = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים LTD", sources: S1 });
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "מעלים ל-Doka" }], baseVersion: 0 });
    const r = await proposeKnowledge(ariel, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "PROCESS", action: "SUPERSEDE", targetId: p.id, reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", slaText: "יומיים לפני" } }],
    });
    const proposal = (await listOpenBatches(ariel, { clientId: client.id })).find((b) => b.id === r.batchId)!.proposals[0];
    const approved = await approveProposal(ariel, proposal.id);
    expect(approved.procedure).toBeNull();
    expect((await processOf(p.id)).versions.map((v) => v.status)).toEqual(["DRAFT"]);
  });

  it("decide_knowledge_proposals says the procedure was approved", async () => {
    const { client, ariel } = await setup();
    const { proposal } = await proposeProcess(ariel, client.id, GOOD_STEPS);
    const r = await decideProposalForAi(ariel, proposal.id, "approve", null);
    expect(r.procedure).toEqual({ approved: true, version: 1 });
    expect((await processOf(r.resultId!)).status).toBe("ACTIVE");
  });
});
