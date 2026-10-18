import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addProcess, approveProcessVersion, saveProcessVersion, updateProcess } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { setStepDone, STEP_APPROVAL_REQUESTED, updateTask } from "@/lib/app-domain/tasks";

// An approval step in a run belongs to a person (claude/org-brain-spec-
// 2026-10-12.md, 5.3). What is worth holding: with an approver at Ankora
// the step waits for their signature and the run does not close around
// it; whoever did the work sends it, the approver is told and signs; an
// approver at the client is named on the step; and the approver must be
// someone who can reach the client.

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const process = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: S1 });
  await saveProcessVersion(hadas, process.id, {
    steps: [
      { title: "מכינים קובץ תשלומים", actionTags: ["INVOICE"] },
      { title: "מאשרים את התשלום", actionTags: ["PAYMENT"], requiresApproval: true },
    ],
    baseVersion: 0,
  });
  await approveProcessVersion(ariel, process.id, 1);
  return { client, hadas, ariel, process };
}

const stepsOf = (runId: string) => prisma.task.findMany({ where: { parentId: runId }, orderBy: { createdAt: "asc" } });

describe("the approval step of a run", () => {
  it("waits for the approver at Ankora: sent, signed, and only then the run closes", async () => {
    const { hadas, ariel, process } = await setup();
    await updateProcess(hadas, process.id, { approverUserId: ariel.id });
    const run = await startProcessRun(hadas, process.id, new Date("2026-11-10T00:00:00Z"));
    const [, approval] = await stepsOf(run.id);
    expect(approval).toMatchObject({ requiresApproval: true, supervisorId: ariel.id });
    expect(approval.title).toContain(`דורש אישור של ${ariel.name}`);

    await expect(updateTask(hadas, run.id, { status: "DONE" })).rejects.toThrow("מחכה לאישור");

    expect(await setStepDone(hadas, approval.id, true)).toBe("sent");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("PENDING_APPROVAL");
    expect(await prisma.notification.count({ where: { userId: ariel.id, type: STEP_APPROVAL_REQUESTED } })).toBe(1);
    await expect(setStepDone(hadas, approval.id, true)).rejects.toThrow("כבר מחכה לאישור");

    expect(await setStepDone(ariel, approval.id, true)).toBe("approved");
    expect(await prisma.task.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "DONE", approvedById: ariel.id });

    await updateTask(hadas, run.id, { status: "DONE" });
    expect((await stepsOf(run.id)).every((s) => s.status === "DONE")).toBe(true);
  });

  it("an approver at the client is named on the step, and the step is ticked as usual", async () => {
    const { client, hadas, process } = await setup();
    const oren = await addClientContact(hadas, { clientId: client.id, name: "אורן", role: "CEO", sources: S1 });
    await updateProcess(hadas, process.id, { approverContactId: oren.id });
    const run = await startProcessRun(hadas, process.id, new Date("2026-11-10T00:00:00Z"));
    const [, approval] = await stepsOf(run.id);
    expect(approval.title).toContain("דורש אישור של אורן");
    expect(approval.requiresApproval).toBe(false);
    expect(await setStepDone(hadas, approval.id, true)).toBe("done");
  });

  it("the approver at Ankora must reach the client", async () => {
    const { hadas, process } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(updateProcess(hadas, process.id, { approverUserId: stranger.id })).rejects.toThrow("המאשר באנקורה");
  });
});
