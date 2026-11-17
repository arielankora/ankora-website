import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";

// 17.11.2026: the busiest read tools explain their result fields in the
// result (`fieldNotes`), not in their description, so a new field changes
// no tool definition and Claude Desktop does not ask to allow the tool
// again. Through the connector, with real data: each note arrives with
// its field, and only with it.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
type Validated = { value?: unknown; issues?: readonly { message: string }[] };
type Schema = { "~standard"?: { validate: (v: unknown) => Validated | Promise<Validated> } };
const tools = new Map<string, { schema: Schema; handler: Handler }>();
registerAnkoraTools({ registerTool: (name: string, c: { inputSchema: Schema }, h: Handler) => tools.set(name, { schema: c.inputSchema, handler: h }) } as never);

async function call(user: User, name: string, args: unknown) {
  const tool = tools.get(name)!;
  const validated = await tool.schema["~standard"]!.validate(args);
  if (validated.issues) throw new Error(`schema refused ${name}: ${validated.issues.map((i) => i.message).join("; ")}`);
  const result = await tool.handler(validated.value, { http: { authInfo: { extra: { user } } } });
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0].text);
}

const MEETING = { kind: "TRANSCRIPT" as const, title: "Field notes", occurredAt: new Date("2026-11-10T00:00:00Z"), externalIds: ["ff-notes-1"] };

describe("fieldNotes through the connector", () => {
  it("get_proposal_stats, list_approvals and decide_knowledge_proposals explain the fields they return", async () => {
    const client = await createTestClient({ name: "Notes" });
    const { user } = await createTestUser({ role: "SUPER_ADMIN" });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", topic: "COMMUNICATION", body: "הדוח נשלח ב-10 לחודש" } },
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", topic: "COMMUNICATION", body: "פגישה כל שני" } },
      ],
    });
    const [batch] = (await listOpenBatches(user, { clientId: client.id })).filter((b) => b.id === r.batchId);
    const [edited, waiting] = batch.proposals;
    await approveProposal(user, edited.id, { body: "הדוח נשלח ב-15 לחודש" });

    // Groups only: no note about rows or their fields.
    const groupsOnly = await call(user, "get_proposal_stats", {});
    expect(Object.keys(groupsOnly.fieldNotes)).toContain("groups");
    expect(groupsOnly.fieldNotes).not.toHaveProperty("rows");
    expect(groupsOnly.fieldNotes).not.toHaveProperty("editKind");

    // With rows: the short-row rule and the edit fields the rows carry,
    // and nothing about auto-apply errors no row has.
    const stats = await call(user, "get_proposal_stats", { rows: true });
    expect(stats.fieldNotes.rows).toContain("a field that is false, null or an empty list is left out");
    expect(stats.fieldNotes.editKind).toContain("WORDING");
    expect(stats.fieldNotes).toHaveProperty("editedFields");
    expect(stats.fieldNotes).not.toHaveProperty("autoError");

    const approvals = await call(user, "list_approvals", { client: "Notes" });
    expect(approvals.fieldNotes.approvals).toContain("decide_approval");
    expect(approvals.fieldNotes.proposals).toContain("proposalId");
    expect(approvals.fieldNotes).not.toHaveProperty("autoApplyPauses");

    const decided = await call(user, "decide_knowledge_proposals", { proposalIds: [waiting.id], decision: "reject", reason: "לא נכון" });
    expect(decided.done).toBe(1);
    expect(decided.fieldNotes.results).toContain("`url`");
    expect(decided.fieldNotes).not.toHaveProperty("errors");
  });

  it("list_processes and get_process explain the process fields, get_process its procedure too", async () => {
    const client = await createTestClient({ name: "NUX" });
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: created } = await createTestUser({ role: "ANKORA_ADMIN" });
    const ariel = await prisma.user.update({ where: { id: created.id }, data: { canApproveExceptions: true } });
    await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
    await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
    const p1 = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", purpose: "לשלם בזמן", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: [{ code: "S1" }] });
    await saveProcessVersion(hadas, p1.id, { steps: [{ title: "מאשרים תשלום", actionTags: ["PAYMENT"], requiresApproval: true }], baseVersion: 0 });
    await approveProcessVersion(ariel, p1.id, 1);

    const list = await call(hadas, "list_processes", { client: "NUX" });
    expect(list.fieldNotes.notRunningBecause).toContain("Tell the user all of them");
    expect(list.fieldNotes.rhythm).toContain("Quote it rather than `trigger`");
    expect(list.fieldNotes).toHaveProperty("url");
    expect(list.fieldNotes).not.toHaveProperty("steps");

    const detail = await call(hadas, "get_process", { client: "NUX", process: p1.code });
    expect(detail.fieldNotes).toHaveProperty("notRunningBecause");
    expect(detail.fieldNotes.procedure).toContain("Follow it");
    expect(detail.fieldNotes.steps).toContain("needs approval");
    expect(detail.fieldNotes.failsRules).toContain("say so before acting");
  });
});
