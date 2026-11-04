import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, saveAndActivateProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";
import { readFlow, type FlowNode } from "@/lib/process-flow";

// 4.11.2026 (task cmvtivumj000pjs08q9qj4t67): a procedure built as a flow
// is saved with its steps derived from it, and "שמור והפעל" puts it live at
// once, unless it needs a second pair of eyes (Ariel's decisions, step 3).

const S1 = [{ code: "S1" }];

async function setup(opts: { separation?: boolean } = {}) {
  const client = await createTestClient({ name: "NUX" });
  const { user: manager } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: colleague } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: manager.id, procedureApprovalSeparation: opts.separation ?? false } });
  for (const u of [manager, colleague]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await addClientSource(manager, { clientId: client.id, kind: "TRANSCRIPT", title: "שיחה" });
  const process = await addProcess(manager, { clientId: client.id, title: "דוחות חודשיים", sources: S1 });
  return { client, manager, colleague, process };
}

const action = (id: string, next: string, extra: Partial<FlowNode> = {}): Record<string, unknown> => ({
  id,
  kind: "ACTION",
  title: id,
  step: { title: id, mode: "MANUAL" },
  next,
  ...extra,
});

const flow = (remindMode: "DRAFT" | "AUTO"): { v: 1; start: string; nodes: Record<string, unknown>[] } => ({
  v: 1,
  start: "ask",
  nodes: [
    action("ask", "got", { send: { mode: "DRAFT", toContactId: null, toText: "כספים", body: null } }),
    {
      id: "got",
      kind: "CONDITION",
      title: "הגיעו?",
      question: "האם הדוחות הגיעו?",
      branches: [{ id: "b1", label: "ענה", source: "MANUAL", next: "close" }],
      elseAfterBusinessDays: 3,
      elseNext: "remind",
    },
    action("remind", "close", { send: { mode: remindMode, toContactId: null, toText: "כספים", body: "שלום {{שם איש הקשר}}, עדיין מחכים לדוחות של {{חודש}}." } }),
    action("close", "end", { waitBusinessDays: 1 }),
    { id: "end", kind: "END", title: "סיום" },
  ],
});

describe("a procedure as a flow", () => {
  it("is stored with the flow and steps derived from it", async () => {
    const { manager, process } = await setup();
    const row = await saveProcessVersion(manager, process.id, { steps: [{ title: "ignored" }], flow: flow("DRAFT"), baseVersion: 0 });
    expect(readFlow(row.flow)?.nodes.map((n) => n.id)).toEqual(["ask", "got", "remind", "close", "end"]);
    expect((row.steps as { title: string }[]).map((s) => s.title)).toEqual(["ask", "remind", "close"]);
  });

  it("is refused when a path does not end", async () => {
    const { manager, process } = await setup();
    const broken = flow("DRAFT");
    (broken.nodes[3] as { next: string | null }).next = null;
    await expect(saveProcessVersion(manager, process.id, { steps: [], flow: broken, baseVersion: 0 })).rejects.toThrow("לא ממשיך");
  });

  it("goes live at once when the account manager saves it", async () => {
    const { manager, process } = await setup();
    const res = await saveAndActivateProcessVersion(manager, process.id, { steps: [], flow: flow("DRAFT"), baseVersion: 0 });
    expect(res).toEqual({ live: true, version: 1 });
    const v = await prisma.processVersion.findFirstOrThrow({ where: { processId: process.id, version: 1 } });
    expect(v.status).toBe("APPROVED");
    expect(v.approvedById).toBe(manager.id);
    expect((await prisma.process.findUniqueOrThrow({ where: { id: process.id } })).status).toBe("ACTIVE");
  });

  it("waits for a second pair of eyes when it mails the client on its own, and the live version keeps running", async () => {
    const { manager, process } = await setup();
    await saveAndActivateProcessVersion(manager, process.id, { steps: [], flow: flow("DRAFT"), baseVersion: 0 });
    const res = await saveAndActivateProcessVersion(manager, process.id, { steps: [], flow: flow("AUTO"), baseVersion: 1 });
    expect(res.live).toBe(false);
    expect(res.live === false && res.secondEye).toEqual(["remind"]);
    const versions = await prisma.processVersion.findMany({ where: { processId: process.id }, orderBy: { version: "asc" }, select: { status: true } });
    expect(versions.map((v) => v.status)).toEqual(["APPROVED", "DRAFT"]);
  });

  it("stays a draft for someone who does not approve this client's procedures, and where the client separates author and approver", async () => {
    const { colleague, process } = await setup();
    const res = await saveAndActivateProcessVersion(colleague, process.id, { steps: [], flow: flow("DRAFT"), baseVersion: 0 });
    expect(res.live).toBe(false);

    const sep = await setup({ separation: true });
    const res2 = await saveAndActivateProcessVersion(sep.manager, sep.process.id, { steps: [], flow: flow("DRAFT"), baseVersion: 0 });
    expect(res2.live === false && res2.reason).toContain("עין שנייה");
  });
});
