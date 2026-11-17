import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { createTestClient, createTestUser } from "./factories";
import { approveProposal, listOpenBatches, proposeKnowledge, rejectProposal } from "@/lib/app-domain/knowledge-proposals";
import { proposalStatsForAi } from "@/lib/app-domain/proposal-stats";

// get_proposal_stats through the connector, rows written short (17.11.2026,
// stage 4 of the Claude usage work): the same facts as the domain's rows,
// in about half the bytes.

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
  return tool.handler(validated.value, { http: { authInfo: { extra: { user } } } });
}

const MEETING = { kind: "TRANSCRIPT" as const, title: "Compact rows", occurredAt: new Date("2026-11-10T00:00:00Z"), externalIds: ["ff-compact-1"] };

describe("get_proposal_stats rows through the connector", () => {
  it("leaves out false, null and repeated fields, and keeps every fact", async () => {
    const client = await createTestClient({ name: "Compact" });
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
    const [edited, rejected] = batch.proposals;
    await approveProposal(user, edited.id, { body: "הדוח נשלח ב-15 לחודש" });
    await rejectProposal(user, rejected.id, "לא נכון");

    const result = await call(user, "get_proposal_stats", { rows: true });
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text);
    const rows = Object.fromEntries(body.rows.map((x: { id: string }) => [x.id, x]));

    // What is true stays, what is false or empty goes.
    expect(rows[edited.id]).toMatchObject({ state: "APPROVED", edited: true, editedFields: ["body"], editKind: "FACT" });
    expect(rows[edited.id]).not.toHaveProperty("sensitive");
    expect(rows[edited.id]).not.toHaveProperty("autoApplied");
    expect(rows[edited.id]).not.toHaveProperty("decidedAt");
    expect(rows[edited.id].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);
    // A rejection is read from state.
    expect(rows[rejected.id]).toMatchObject({ state: "REJECTED" });
    expect(rows[rejected.id]).not.toHaveProperty("rejected");

    // Well under the domain's rows (about half; more on a typical unedited row).
    const full = await proposalStatsForAi(user, { rows: true });
    expect(JSON.stringify(body.rows).length).toBeLessThan(JSON.stringify(full.rows).length * 0.6);
    // The summary parts are unchanged.
    expect(body.groups).toEqual(full.groups);
  });
});
