import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { setStepEvidenceLink } from "@/lib/app-domain/tasks";

// A link to evidence on each run step (14.11.2026, processes redesign, spec
// 4.5): only on a run step of a client with audit requirements, only https,
// cleared with null, and written to the audit log.

const S1 = [{ code: "S1" }];

async function setup(audit: boolean) {
  const client = await createTestClient({ name: "NUX" });
  await prisma.client.update({ where: { id: client.id }, data: { auditRequirements: audit } });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: created } = await createTestUser({ role: "ANKORA_ADMIN" });
  const ariel = await prisma.user.update({ where: { id: created.id }, data: { canApproveExceptions: true } });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const p = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: S1 });
  await saveProcessVersion(hadas, p.id, { steps: [{ title: "איסוף חשבוניות" }, { title: "העברה" }], baseVersion: 0 });
  await approveProcessVersion(ariel, p.id, 1);
  const run = await startProcessRun(hadas, p.id, new Date("2026-11-16T00:00:00Z"));
  const steps = await prisma.task.findMany({ where: { parentId: run.id }, orderBy: { createdAt: "asc" } });
  return { hadas, run, steps };
}

describe("a link to a run step's evidence", () => {
  it("keeps, replaces and clears an https link, with an audit line", async () => {
    const { hadas, steps } = await setup(true);
    await setStepEvidenceLink(hadas, steps[0].id, " https://drive.example/a ");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: steps[0].id } })).evidenceLink).toBe("https://drive.example/a");
    await setStepEvidenceLink(hadas, steps[0].id, null);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: steps[0].id } })).evidenceLink).toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityId: steps[0].id, action: "task.evidence_link" } })).toBe(2);
    await expect(setStepEvidenceLink(hadas, steps[1].id, "http://x.example")).rejects.toMatchObject({ code: "tasks.badEvidenceLink" });
  });

  it("is not kept on a run itself or for a client without audit requirements", async () => {
    const audited = await setup(true);
    await expect(setStepEvidenceLink(audited.hadas, audited.run.id, "https://x.example")).rejects.toMatchObject({ code: "tasks.evidenceNotHere" });
    const plain = await setup(false);
    await expect(setStepEvidenceLink(plain.hadas, plain.steps[0].id, "https://x.example")).rejects.toMatchObject({ code: "tasks.evidenceNotHere" });
  });
});
