import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { addClientContact, updateClientContact } from "@/lib/app-domain/client-contacts";

import { recordClientApproval, updateTask } from "@/lib/app-domain/tasks";
import { readSteps } from "@/lib/process-rules";
import { stepsNeedingApprover } from "@/lib/step-approval";

// An approver for each step (14.11.2026, processes redesign, stage 3, spec
// 4.4 to 4.6). What is worth holding: an Ankora approver is still a gate on
// the run's step; a contact at the client is not, but the step is closed
// only with when and how they approved, and the run is not closed around
// it; a contact who left marks the steps they approve; and the backfill
// moves a process's approver to its approval steps.

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: guy } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: created } = await createTestUser({ role: "ANKORA_ADMIN" });
  const ariel = await prisma.user.update({ where: { id: created.id }, data: { canApproveExceptions: true } });
  for (const u of [hadas, guy]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const dana = await addClientContact(hadas, { clientId: client.id, name: "דנה כהן", role: "סמנכ\"לית כספים", sources: S1 });
  const p = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: S1 });
  await saveProcessVersion(hadas, p.id, {
    steps: [
      { title: "איסוף חשבוניות" },
      { title: "התאמה להזמנות", approverUserId: guy.id },
      { title: "אישור רשימת התשלומים", approverContactId: dana.id, evidence: "מייל מדנה" },
    ],
    baseVersion: 0,
  });
  await approveProcessVersion(ariel, p.id, 1);
  return { client, hadas, guy, ariel, dana, p };
}

describe("step approvers", () => {
  it("reads a step's approver, and a named approver asks for an approval", () => {
    const [a, b, c] = readSteps([
      { title: "x", approverUserId: "u1", approverContactId: "c1" },
      { title: "y", approverContactId: "c1", evidence: " מייל " },
      { title: "z", requiresApproval: true },
    ]);
    expect(a).toMatchObject({ requiresApproval: true, approverUserId: "u1" });
    expect(a.approverContactId).toBeUndefined();
    expect(b).toMatchObject({ requiresApproval: true, approverContactId: "c1", evidence: "מייל" });
    expect(c.requiresApproval).toBe(true);
    expect(c.approverUserId).toBeUndefined();
  });

  it("opens a run whose Ankora approver is a gate and whose client approver is named", async () => {
    const { hadas, guy, dana, p } = await setup();
    const run = await startProcessRun(hadas, p.id, new Date("2026-11-16T00:00:00Z"));
    const steps = await prisma.task.findMany({ where: { parentId: run.id }, orderBy: { createdAt: "asc" } });
    expect(steps.map((s) => [s.requiresApproval, s.supervisorId, s.approvalContactId])).toEqual([
      [false, null, null],
      [true, guy.id, null],
      [false, null, dana.id],
    ]);
    expect(steps[2].title).toContain("דנה כהן");
  });

  it("closes a client-approved step only with when and how, and not by closing the run", async () => {
    const { hadas, p } = await setup();
    const run = await startProcessRun(hadas, p.id, new Date("2026-11-16T00:00:00Z"));
    const steps = await prisma.task.findMany({ where: { parentId: run.id }, orderBy: { createdAt: "asc" } });
    const step = steps[2];
    await expect(updateTask(hadas, step.id, { status: "DONE" })).rejects.toMatchObject({ code: "tasks.clientApprovalUndocumented" });
    await expect(updateTask(hadas, run.id, { status: "DONE" })).rejects.toMatchObject({ code: "tasks.stepAwaitingClientApproval" });
    await expect(recordClientApproval(hadas, step.id, { at: "2099-01-01", how: "EMAIL" })).rejects.toMatchObject({ code: "stepApprovals.futureDate" });
    await expect(recordClientApproval(hadas, step.id, { at: "2026-11-12", how: "PIGEON" })).rejects.toMatchObject({ code: "stepApprovals.badHow" });
    await expect(recordClientApproval(hadas, steps[0].id, { at: "2026-11-12", how: "EMAIL" })).rejects.toMatchObject({ code: "stepApprovals.notClientApproval" });

    await recordClientApproval(hadas, step.id, { at: "2026-11-12", how: "EMAIL", link: "https://mail.example/1" });
    const done = await prisma.task.findUniqueOrThrow({ where: { id: step.id } });
    expect(done.status).toBe("DONE");
    expect(done.approvalEvidence).toMatchObject({ at: "2026-11-12", how: "EMAIL", link: "https://mail.example/1", byUserId: hadas.id });
    expect(await prisma.auditEvent.count({ where: { entityId: step.id, action: "task.client_approval" } })).toBe(1);
  });

  it("marks the steps a contact who left approves", async () => {
    const { hadas, dana, p } = await setup();
    await updateClientContact(hadas, dana.id, { endedAt: "2026-11-15" });
    const contact = await prisma.clientContact.findUniqueOrThrow({ where: { id: dana.id } });
    expect(contact.endedAt?.toISOString().slice(0, 10)).toBe("2026-11-15");
    const version = await prisma.processVersion.findFirstOrThrow({ where: { processId: p.id, version: 1 } });
    expect(stepsNeedingApprover(readSteps(version.steps), new Map([[dana.id, "דנה כהן"]]))).toEqual([{ step: 3, name: "דנה כהן" }]);
    await expect(updateClientContact(hadas, dana.id, { endedAt: "2026-02-30" })).rejects.toMatchObject({ code: "clientContacts.badEndedAt" });
    await updateClientContact(hadas, dana.id, { endedAt: null });
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: dana.id } })).endedAt).toBeNull();
  });
});

describe("the approvers backfill (spec 6.3)", () => {
  it("moves a process's approver to its approval steps, in steps and in a flow, once", async () => {
    const client = await createTestClient({ name: "NUX" });
    const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
    const p = await prisma.process.create({ data: { clientId: client.id, seq: 1, code: "P1", title: "T", approverUserId: ariel.id } });
    const q = await prisma.process.create({ data: { clientId: client.id, seq: 2, code: "P2", title: "U", approverText: "מורשה החתימה" } });
    const flow = { v: 1, start: "n1", nodes: [{ id: "n1", kind: "ACTION", title: "a", step: { title: "a", requiresApproval: true } }, { id: "n2", kind: "END", title: "end", step: null }] };
    const v = await prisma.processVersion.create({
      data: { processId: p.id, version: 1, steps: [{ title: "a" }, { title: "b", requiresApproval: true }, { title: "c", requiresApproval: true, approverContactId: "keep" }], flow },
    });
    const w = await prisma.processVersion.create({ data: { processId: q.id, version: 1, steps: [{ title: "a", requiresApproval: true }] } });

    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261114120100_step_approvers_backfill/migration.sql"), "utf8");
    // The temporary function lives for the session: one connection, run twice.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(sql.split(/\$\$ LANGUAGE sql IMMUTABLE;/)[0] + "$$ LANGUAGE sql IMMUTABLE;");
      const rest = sql
        .split(/\$\$ LANGUAGE sql IMMUTABLE;/)[1]
        .split(/;\s*\n/)
        .map((x) => x.replace(/^\s*--.*$/gm, "").trim())
        .filter(Boolean);
      for (const s of [...rest, ...rest]) await tx.$executeRawUnsafe(s);
    });

    const after = await prisma.processVersion.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.steps).toEqual([{ title: "a" }, { title: "b", requiresApproval: true, approverUserId: ariel.id }, { title: "c", requiresApproval: true, approverContactId: "keep" }]);
    expect((after.flow as { nodes: { step: unknown }[] }).nodes.map((n) => n.step)).toEqual([{ title: "a", requiresApproval: true, approverUserId: ariel.id }, null]);
    // Free text is not guessed.
    expect((await prisma.processVersion.findUniqueOrThrow({ where: { id: w.id } })).steps).toEqual([{ title: "a", requiresApproval: true }]);
  });
});
