import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";

// 31.10.2026, RIMED: the reproduction from the bug report, through the
// tool as a client calls it. The arguments are parsed by the schema the
// tool publishes first, as the MCP server does, so a field the schema
// strips never reaches the handler here either.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));
import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[] }>;
// Since #361 the tool publishes a Standard Schema (lib/mcp/proposal-schema.ts,
// publishAs), not a zod object, so it is validated the way the MCP server
// does: through `~standard.validate`.
type Issue = { message: string; path?: readonly (PropertyKey | { key: PropertyKey })[] };
type Validated = { value?: unknown; issues?: readonly Issue[] };
type Standard = { "~standard": { validate: (v: unknown) => Validated | Promise<Validated> } };
const tools = new Map<string, { schema: Standard; handler: Handler }>();
registerAnkoraTools({ registerTool: (name: string, c: { inputSchema: Standard }, h: Handler) => tools.set(name, { schema: c.inputSchema, handler: h }) } as never);

const pathOf = (i: Issue) => (i.path ?? []).map((p) => (typeof p === "object" && p !== null ? String(p.key) : String(p))).join(".");

async function propose(user: User, args: unknown) {
  const tool = tools.get("propose_knowledge")!;
  const result = await tool.schema["~standard"].validate(args);
  if (result.issues) throw new Error(result.issues.map((i) => `${pathOf(i)}: ${i.message}`).join("; "));
  const parsed = result.value;
  const text = (await tool.handler(parsed, { http: { authInfo: { extra: { user } } } })).content.map((c) => c.text).join("");
  return JSON.parse(text);
}

async function setup() {
  const client = await createTestClient({ name: "RIMED" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  const source = await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "שיחה עם המנכ״ל" });
  return { client, user, source };
}

const PREFERENCE = { target: "FACT", payload: { kind: "PREFERENCE", body: "מעדיפים עדכון במייל, לא בטלפון" }, reason: "נאמר בשיחה", confidence: "HIGH" };

describe("propose_knowledge, the RIMED reproduction", () => {
  it("1. a FACT PREFERENCE with an existing sourceCode and no status is proposed", async () => {
    const { user, source } = await setup();
    const r = await propose(user, { client: "RIMED", sourceCode: source.code, items: [PREFERENCE] });
    expect(r).toMatchObject({ proposed: 1, dropped: [] });
    const p = await prisma.knowledgeProposal.findFirstOrThrow({ where: { batchId: r.batchId } });
    expect((p.payload as { knowledgeStatus: string }).knowledgeStatus).toBe("CONFIRMED");
  });

  it("2. status sent on the item and in the payload reaches the server and is kept", async () => {
    const { user, source } = await setup();
    const r = await propose(user, {
      client: "RIMED",
      sourceCode: source.code,
      items: [{ ...PREFERENCE, confidence: "LOW", status: "CONFIRMED", payload: { ...PREFERENCE.payload, status: "CONFIRMED" } }],
    });
    expect(r).toMatchObject({ proposed: 1, dropped: [] });
    const p = await prisma.knowledgeProposal.findFirstOrThrow({ where: { batchId: r.batchId } });
    expect((p.payload as { knowledgeStatus: string }).knowledgeStatus).toBe("CONFIRMED");
  });

  it("3. a POLICY of kind COMMUNICATION is proposed", async () => {
    const { user, source } = await setup();
    const r = await propose(user, {
      client: "RIMED",
      sourceCode: source.code,
      items: [{ target: "POLICY", payload: { kind: "COMMUNICATION", title: "עדכונים במייל", statement: "כל עדכון נשלח במייל" }, reason: "נאמר בשיחה", confidence: "HIGH" }],
    });
    expect(r).toMatchObject({ proposed: 1, dropped: [] });
  });

  it("4. a newSource of kind PERSON is registered once, with its item", async () => {
    const { client, user } = await setup();
    const r = await propose(user, { client: "RIMED", newSource: { kind: "PERSON", title: "שיחה עם סמנכ״ל הכספים" }, items: [PREFERENCE] });
    expect(r).toMatchObject({ sourceCode: "S2", proposed: 1 });
  });

  it("an invalid status is refused before the handler, with its path", async () => {
    const { user, source } = await setup();
    await expect(propose(user, { client: "RIMED", sourceCode: source.code, items: [{ ...PREFERENCE, status: "SURE" }] })).rejects.toThrow(/items[\s\S]*0[\s\S]*status/);
  });

  it("a newSource whose items are all dropped is not registered", async () => {
    const { client, user } = await setup();
    const r = await propose(user, { client: "RIMED", newSource: { kind: "PERSON", title: "שיחה ריקה" }, items: [{ target: "FACT", payload: { kind: "NOTE", body: "x" } }] });
    expect(r).toMatchObject({ proposed: 0, sourceCode: null, dropped: [{ index: 0, reason: expect.stringContaining("items[0].reason") }] });
    expect(await prisma.clientSource.count({ where: { clientId: client.id } })).toBe(1);
  });
});
