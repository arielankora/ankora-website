import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { createTestClient, createTestUser } from "./factories";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";

// get_client_brief through the connector, shorter (17.11.2026, stage 4 of
// the Claude usage work): a text item keeps its words, its status and its
// "do not tell", and loses its source codes, owner and id, which only the
// full file uses.

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

const MEETING = { kind: "TRANSCRIPT" as const, title: "Brief", occurredAt: new Date("2026-11-10T00:00:00Z"), externalIds: ["ff-brief-short-1"] };

describe("get_client_brief through the connector", () => {
  it("keeps the words of a requirement and leaves out its source codes and id", async () => {
    const client = await createTestClient({ name: "BriefShort" });
    const { user } = await createTestUser({ role: "SUPER_ADMIN" });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "REQUIREMENT", topic: "REPORTING", body: "דוח חודשי עד ה-10 לחודש" } }],
    });
    const [batch] = (await listOpenBatches(user, { clientId: client.id })).filter((b) => b.id === r.batchId);
    await approveProposal(user, batch.proposals[0].id, {});

    const result = await call(user, "get_client_brief", { client: "BriefShort" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    const line = text.split("\n").find((l) => l.includes("דוח חודשי עד ה-10 לחודש"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/\[S\d/);
    expect(line).not.toContain("(id:");
    expect(line).not.toContain("בעלים:");

    // The full file still has the source code and the legend.
    const file = (await call(user, "get_client_file", { client: "BriefShort" })).content[0].text;
    expect(file.split("\n").find((l) => l.includes("דוח חודשי עד ה-10 לחודש"))).toMatch(/\[S\d/);
  });
});
