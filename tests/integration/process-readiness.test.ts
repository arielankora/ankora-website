import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addProcess, approveProcessVersion, listProcesses, saveProcessVersion, setProcessFieldNotApplicable } from "@/lib/app-domain/processes";
import { runStep } from "@/lib/app-domain/process-next-steps";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";

// 25.10.2026 (Ariel: "there is always something missing"): whether a
// process runs, apart from how well it is written down; a field marked not
// relevant stops counting; and what the process's own words name is offered
// to link, never linked on its own.

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  for (const u of [hadas, anna]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  return { client, hadas, anna, ariel };
}

describe("run readiness and documentation", () => {
  it("a process with an approved procedure runs, and its documentation is shown apart", async () => {
    const { client, hadas, ariel } = await setup();
    const p = await addProcess(hadas, { clientId: client.id, title: "קליטת עובד", triggerKinds: ["EVENT"], triggerText: "עובד חדש", ownerId: hadas.id, approverText: "אורן", sources: S1 });
    let [row] = await listProcesses(hadas, client.id);
    expect(row.readiness).toEqual({ ready: false, blocker: "לא ירוץ: אין נוהל מאושר" });
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "לאסוף טופס 101", mode: "MANUAL", actionTags: [], requiresApproval: false, systemIds: [] }], baseVersion: 0 });
    await approveProcessVersion(ariel, p.id, 1);
    [row] = await listProcesses(hadas, client.id);
    expect(row.readiness).toEqual({ ready: true, blocker: null });
    // A named approver is enough: sla, systems, permissions, external and exceptions are missing.
    expect(row.documentation).toMatchObject({ score: 1, of: 6 });
    const md = toMarkdown(await buildClientFile(hadas, client.id, { audience: "ai" }));
    expect(md).toContain("רץ");
    expect(md).toContain("תיעוד 1 מתוך 6");
  });

  it("the owner or a manager marks a field not relevant, it stops counting, and it is recorded and reversible", async () => {
    const { client, hadas, anna, ariel } = await setup();
    const p = await addProcess(hadas, { clientId: client.id, title: "קליטת עובד", triggerKinds: ["EVENT"], triggerText: "עובד חדש", ownerId: hadas.id, sources: S1 });
    await expect(setProcessFieldNotApplicable(anna, p.id, "external", true)).rejects.toThrow("רק מנהל או הבעלים");
    await expect(setProcessFieldNotApplicable(hadas, p.id, "owner", true)).rejects.toThrow("אי אפשר");
    await setProcessFieldNotApplicable(hadas, p.id, "external", true);
    await runStep(ariel, { type: "mark_not_applicable", processId: p.id, field: "systems" });
    let [row] = await listProcesses(hadas, client.id);
    expect(row.notApplicable).toEqual(["external", "systems"]);
    expect(row.documentation.of).toBe(3);
    expect(row.documentation.missing).toEqual(["sla", "approvals", "exceptions"]);
    expect(row.gaps.join(" ")).not.toContain("גורם חיצוני");
    const audit = await prisma.auditEvent.findMany({ where: { action: "process.field_not_applicable", entityId: p.id } });
    expect(audit).toHaveLength(2);
    await setProcessFieldNotApplicable(hadas, p.id, "external", false);
    [row] = await listProcesses(hadas, client.id);
    expect(row.notApplicable).toEqual(["systems"]);
  });

  it("offers to link the system and the contact its words name, and links on one click only", async () => {
    const { client, hadas } = await setup();
    const bank = await addSystemAccess(hadas, { clientId: client.id, systemName: "בנק לאומי", accessStatus: "HAS_ACCESS", sources: S1 });
    await addSystemAccess(hadas, { clientId: client.id, systemName: "Mercury", accessStatus: "HAS_ACCESS", sources: S1 });
    const dikla = await addClientContact(hadas, { clientId: client.id, name: "דקלה כרמי", relationship: "PROVIDER", sources: S1 });
    const p = await addProcess(hadas, {
      clientId: client.id,
      title: "תשלומי ספקים",
      triggerKinds: ["EVENT"],
      triggerText: "חשבונית חדשה",
      ownerId: hadas.id,
      executorText: "הדס שולחת לדקלה כרמי, והתשלום מאושר באפליקציה של בנק לאומי",
      sources: S1,
    });
    let [row] = await listProcesses(hadas, client.id);
    expect(row.suggestions.systems).toEqual([{ id: bank.id, name: "בנק לאומי" }]);
    expect(row.suggestions.contacts).toEqual([{ id: dikla.id, name: "דקלה כרמי" }]);
    // Named, so the outside party counts; nothing linked yet.
    expect(row.documentation.missing).not.toContain("external");
    expect(row.requiredSystemIds).toEqual([]);
    await runStep(hadas, { type: "link_system", processId: p.id, systemId: bank.id });
    await runStep(hadas, { type: "link_contact", processId: p.id, contactId: dikla.id });
    [row] = await listProcesses(hadas, client.id);
    expect(row.requiredSystemIds).toEqual([bank.id]);
    expect(row.externalPartyContactIds).toEqual([dikla.id]);
    expect(row.suggestions).toEqual({ systems: [], contacts: [] });
  });
});
