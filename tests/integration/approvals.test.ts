import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientPolicy } from "@/lib/app-domain/client-policies";
import { requestException } from "@/lib/app-domain/policy-exceptions";
import { collectApprovals, collectReview, countApprovals, countApprovalsForClient } from "@/lib/app-domain/approvals";
import { sentForApprovalAt } from "@/lib/app-domain/task-approval-times";
import { updateTask } from "@/lib/app-domain/tasks";
import type { User } from "@prisma/client";

// "אישורים" (20.10.2026): each row goes to who may decide it, the same
// person the screen it came from would let decide, and nobody else.

const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  for (const u of [hadas, anna]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  // Hadas approves exceptions on this client, nobody else.
  await prisma.client.update({ where: { id: client.id }, data: { ruleApproverIds: [hadas.id] } });
  await addClientSource(anna, { clientId: client.id, kind: "TRANSCRIPT", title: "חפיפה" });

  const confirmed = await addClientPolicy(anna, { clientId: client.id, kind: "SEPARATION", title: "Inc ו-LTD", statement: "לא מערבבים", sources: [{ code: "S1" }] });
  const unsure = await addClientPolicy(anna, { clientId: client.id, kind: "SEPARATION", title: "מתנות", statement: "עד 200 ש\"ח", sources: [{ code: "S1" }] });
  await prisma.clientPolicy.update({ where: { id: unsure.id }, data: { knowledgeStatus: "UNCERTAIN", toResolve: "לשאול את אורן" } });
  await prisma.clientPolicy.update({ where: { id: confirmed.id }, data: { status: "ACTIVE" } });
  const proposed = await addClientPolicy(anna, { clientId: client.id, kind: "SEPARATION", title: "ספק חדש", statement: "רק אחרי רואה חשבון", sources: [{ code: "S1" }] });

  await requestException(anna, { policyId: confirmed.id, what: "לשלוח חשבונית אחת", reason: "דחוף", validUntil: new Date(Date.now() + 3 * DAY) });

  const task = await prisma.task.create({
    data: { clientId: client.id, title: "לסגור את הבנק", status: "PENDING_APPROVAL", requiresApproval: true, supervisorId: hadas.id, assignedToId: anna.id },
  });

  const process = await prisma.process.create({ data: { clientId: client.id, seq: 1, code: "P1", title: "תשלומי ספקים" } });
  await prisma.processVersion.create({ data: { processId: process.id, version: 1, status: "DRAFT", steps: [], changeNote: "גרסה ראשונה" } });

  await prisma.portalSummary.create({ data: { clientId: client.id, periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-10-31T00:00:00Z"), draft: "החודש סגרנו את הבנק." } });

  return { client, hadas, anna, ariel, unsure, proposed, task, process };
}

const mine = async (user: User, clientId: string) => (await collectApprovals(user)).filter((i) => i.clientId === clientId);

describe("approvals", () => {
  it("gives each kind to who may decide it", async () => {
    const { client, hadas, anna, ariel, unsure, proposed, task, process } = await setup();

    // The supervisor signs the task; the client's approver decides the exception.
    const forHadas = await mine(hadas, client.id);
    expect(forHadas.map((i) => i.kind).sort()).toEqual(["exception", "task"]);
    expect(forHadas.find((i) => i.kind === "task")).toMatchObject({ id: task.id, by: anna.name, href: `/app/tasks/${task.id}` });

    // The person who did the work and asked waits; nothing is hers to approve.
    expect(await mine(anna, client.id)).toEqual([]);

    // A manager: rules, the procedure and the summary. Not the task (not
    // the supervisor) and not the exception (the client named Hadas).
    const forAriel = await mine(ariel, client.id);
    expect(forAriel.map((i) => i.kind).sort()).toEqual(["procedure", "rule", "rule", "summary"]);
    const rules = forAriel.filter((i) => i.kind === "rule");
    expect(rules.find((r) => r.id === proposed.id)?.actions.approve).toBe("אישור הכלל");
    // Not confirmed: no approve button, and what would confirm it.
    const blocked = rules.find((r) => r.id === unsure.id);
    expect(blocked?.actions.approve).toBeNull();
    expect(blocked?.blocked).toContain("לשאול את אורן");
    expect(forAriel.find((i) => i.kind === "procedure")).toMatchObject({ id: process.id, version: 1, href: `/app/clients/${client.id}?tab=file#item-${process.id}` });

    expect(await countApprovalsForClient(ariel, client.id)).toBe(4);
    expect(await countApprovals(hadas)).toBeGreaterThanOrEqual(2);
  });

  it("drops a procedure once it is approved, and an exception once it is decided", async () => {
    const { client, ariel, hadas, process } = await setup();
    await prisma.processVersion.updateMany({ where: { processId: process.id }, data: { status: "APPROVED" } });
    await prisma.policyException.updateMany({ where: { clientId: client.id }, data: { status: "APPROVED" } });
    expect((await mine(ariel, client.id)).some((i) => i.kind === "procedure")).toBe(false);
    expect((await mine(hadas, client.id)).some((i) => i.kind === "exception")).toBe(false);
  });

  it("lists what is not yet confirmed: all of it for a manager, their own for anyone else", async () => {
    const { client, ariel, anna, hadas, unsure } = await setup();
    const forAriel = (await collectReview(ariel)).filter((r) => r.clientId === client.id);
    expect(forAriel.find((r) => r.id === unsure.id)).toMatchObject({ kind: "uncertain", href: `/app/clients/${client.id}?tab=file#item-${unsure.id}` });
    expect(forAriel.find((r) => r.id === unsure.id)?.detail).toContain("לשאול את אורן");

    expect((await collectReview(hadas)).filter((r) => r.clientId === client.id)).toEqual([]);
    await prisma.clientPolicy.update({ where: { id: unsure.id }, data: { ownerId: hadas.id } });
    expect((await collectReview(hadas)).map((r) => r.id)).toContain(unsure.id);
    expect((await collectReview(anna)).map((r) => r.id)).not.toContain(unsure.id);
  });

  it("dates a signature from the moment the task was handed over, not from its last edit", async () => {
    const { client, anna, hadas } = await setup();
    const task = await prisma.task.create({ data: { clientId: client.id, title: "דוח שנתי", status: "IN_PROGRESS", requiresApproval: true, supervisorId: hadas.id, assignedToId: anna.id } });
    expect((await sentForApprovalAt([task.id])).has(task.id)).toBe(false);
    await updateTask(anna, task.id, { status: "PENDING_APPROVAL" });
    const handed = (await sentForApprovalAt([task.id])).get(task.id);
    expect(handed).toBeInstanceOf(Date);
    await updateTask(anna, task.id, { title: "דוח שנתי 2026" });
    expect((await sentForApprovalAt([task.id])).get(task.id)?.getTime()).toBe(handed!.getTime());
    expect((await mine(hadas, client.id)).find((i) => i.id === task.id)?.since.getTime()).toBe(handed!.getTime());
  });

  it("shows a stranger nothing", async () => {
    const { client } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    expect(await mine(stranger, client.id)).toEqual([]);
    expect((await collectReview(stranger)).filter((r) => r.clientId === client.id)).toEqual([]);
  });
});
