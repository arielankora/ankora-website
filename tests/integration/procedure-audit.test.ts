import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientContact, updateClientContact } from "@/lib/app-domain/client-contacts";
import { addProcess, approveProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";
import { saveProcessRhythm } from "@/lib/app-domain/process-rhythm";
import { documentTabOf } from "@/lib/app-domain/procedure-audit";

// The procedure document's tab (14.11.2026, processes redesign, stage 4).
// What is worth holding: an audited client gets the readiness list and
// "להכין לביקורת", a client without the switch gets neither; "לעדכן" names
// an approver who left and a rhythm saved after the approval; and Claude's
// audit draft fills how each step is known to be done in a new draft
// version, and scope and controls only where there are none.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: unknown) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

const S1 = [{ code: "S1" }];

async function setup(audit: boolean) {
  const client = await createTestClient({ name: "NUX" });
  await prisma.client.update({ where: { id: client.id }, data: { auditRequirements: audit } });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: created } = await createTestUser({ role: "ANKORA_ADMIN" });
  const ariel = await prisma.user.update({ where: { id: created.id }, data: { canApproveExceptions: true } });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const guy = await addClientContact(hadas, { clientId: client.id, name: "גיא", sources: S1 });
  const p = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", purpose: "לשלם בזמן", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: S1 });
  await saveProcessVersion(hadas, p.id, { steps: [{ title: "איסוף", evidence: "קובץ" }, { title: "אישור", approverContactId: guy.id }], baseVersion: 0 });
  await approveProcessVersion(ariel, p.id, 1);
  return { client, hadas, ariel, guy, p };
}

async function tab(clientId: string, processId: string, audit: boolean, approverLeft: { step: number; name: string }[] = []) {
  const p = await prisma.process.findUniqueOrThrow({ where: { id: processId } });
  const v = await prisma.processVersion.findFirstOrThrow({ where: { processId, status: "APPROVED" } });
  return documentTabOf(
    { id: p.id, code: p.code, title: p.title, scope: p.scope, controlRefs: p.controlRefs, classification: p.classification, current: { steps: v.steps as never }, docMissing: [], approverLeft, stranger: null },
    { clientId, clientName: "NUX", audit, aiExcluded: false, rules: [], endedAt: new Map([["גיא", "2026-11-15"]]) }
  );
}

describe("the procedure document's tab", () => {
  it("gives an audited client the readiness list and the prompt, and others neither", async () => {
    const { client, p } = await setup(true);
    const audited = await tab(client.id, p.id, true);
    expect(audited.approved?.version).toBe(1);
    expect(audited.readiness?.items.map((i) => [i.key, i.ok])).toEqual(
      expect.arrayContaining([
        ["scope", false],
        ["controls", false],
        ["evidence", false],
      ])
    );
    expect(audited.prepPrompt).toContain("save_procedure_audit_draft");
    const plain = await tab(client.id, p.id, false);
    expect(plain.readiness).toBeNull();
    expect(plain.prepPrompt).toBeNull();
  });

  it("says the document is out of date when an approver left or the rhythm changed after the approval", async () => {
    const { client, hadas, guy, p } = await setup(false);
    expect((await tab(client.id, p.id, false)).stale).toEqual([]);
    await updateClientContact(hadas, guy.id, { endedAt: "2026-11-15" });
    await saveProcessRhythm(hadas, p.id, [{ kind: "EVENT", description: "בקשה" }]);
    const stale = (await tab(client.id, p.id, false, [{ step: 2, name: "גיא" }])).stale;
    expect(stale.map((r) => r.key)).toEqual(["approverLeft", "rhythmChanged"]);
    expect(stale[0]).toMatchObject({ step: 2, name: "גיא", at: "2026-11-15" });
  });
});

describe("save_procedure_audit_draft", () => {
  it("drafts how each step is known to be done, and fills scope and controls only where empty", async () => {
    const { hadas, p } = await setup(true);
    await prisma.process.update({ where: { id: p.id }, data: { controlRefs: ["CC1.1"] } });
    const r = await call(hadas, "save_procedure_audit_draft", {
      client: "NUX",
      process: p.code,
      scope: "כל ספקי החברה הישראלית",
      controlRefs: ["CC6.2"],
      evidence: [
        { step: 1, text: "לא אמור להיכתב" },
        { step: 2, text: "מייל אישור מגיא בתיק הריצה" },
      ],
    });
    expect(r.json).toMatchObject({ saved: true, draftVersion: 2, evidenceSteps: [2], scopeWritten: true, controlsWritten: false });
    const draft = await prisma.processVersion.findFirstOrThrow({ where: { processId: p.id, version: 2 } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.steps).toMatchObject([{ title: "איסוף", evidence: "קובץ" }, { title: "אישור", evidence: "מייל אישור מגיא בתיק הריצה" }]);
    const process = await prisma.process.findUniqueOrThrow({ where: { id: p.id } });
    expect([process.scope, process.controlRefs]).toEqual(["כל ספקי החברה הישראלית", ["CC1.1"]]);
  });

  it("is refused for a client without audit requirements", async () => {
    const { hadas, p } = await setup(false);
    const r = await call(hadas, "save_procedure_audit_draft", { client: "NUX", process: p.code, scope: "x" });
    expect(r.text).toContain("אין דרישות ביקורת");
  });
});
