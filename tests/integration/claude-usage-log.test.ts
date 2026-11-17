import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { withToolMeasurement, type ToolCallMeasure } from "@/lib/claude-usage/measure";
import { CLAUDE_USAGE_RETENTION_DAYS, pruneClaudeUsage, recordPromptCopy, recordToolCall } from "@/lib/claude-usage/record";

// Claude usage measurement (17.11.2026), through the connector: the real
// tools, registered the way app/api/mcp/route.ts registers them, write one
// row per call to mcp_tool_calls. No argument and no result is kept.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }>;
type Issue = { message: string };
type Validated = { value?: unknown; issues?: readonly Issue[] };
type Schema = { "~standard"?: { validate: (v: unknown) => Validated | Promise<Validated> } };

const registered: string[] = [];
const tools = new Map<string, { schema: Schema; handler: Handler }>();
const pending: Promise<void>[] = [];
const fake = {
  registerTool: (name: string, c: { inputSchema: Schema }, h: Handler) => {
    registered.push(name);
    tools.set(name, { schema: c.inputSchema, handler: h });
  },
};
// The same composition as the route: every tool through the measurement.
const sink = (m: ToolCallMeasure) => pending.push(recordToolCall(m));
registerAnkoraTools(withToolMeasurement(fake, sink) as never);

async function call(user: User, name: string, args: unknown) {
  const tool = tools.get(name)!;
  const validated = await tool.schema["~standard"]!.validate(args);
  if (validated.issues) throw new Error(`schema refused ${name}`);
  const result = await tool.handler(validated.value, { http: { authInfo: { extra: { user } } } });
  await Promise.all(pending.splice(0));
  return result;
}

describe("the MCP call log", () => {
  it("measures every registered tool", () => {
    // The same registration without the measurement: every tool it
    // registers went through the measurement above, so none bypasses it.
    const plain: string[] = [];
    registerAnkoraTools({ registerTool: (name: string) => plain.push(name) } as never);
    expect(plain.length).toBeGreaterThan(50);
    expect(registered).toEqual(plain);
  });

  it("writes one row per call, with who, which tool and how big, and never the arguments or the answer", async () => {
    const client = await createTestClient({ name: "NUX Measured" });
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });

    const result = await call(user, "list_categories", { client: "NUX Measured" });
    const text = result.content.map((c) => c.text ?? "").join("");

    const rows = await prisma.mcpToolCall.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ userId: user.id, tool: "list_categories", imageCount: 0 });
    expect(row.ok).toBe(result.isError !== true);
    expect(row.resultChars).toBe(text.length);
    expect(row.resultBytes).toBe(Buffer.byteLength(text, "utf8"));
    expect(row.argsHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(row)).not.toContain("NUX");
    expect(client.id).toBeTruthy();
  });

  it("gives the same call made twice the same argument hash", async () => {
    await createTestClient({ name: "RIMED" });
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    await call(user, "list_categories", { client: "RIMED" });
    await call(user, "list_categories", { client: "RIMED" });
    await call(user, "list_my_clients", {});
    const rows = await prisma.mcpToolCall.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows[0].argsHash).toBe(rows[1].argsHash);
    expect(rows[2].argsHash).not.toBe(rows[0].argsHash);
  });

  it("records a refusal as not ok", async () => {
    // get_proposal_stats is for managers; an employee gets a DomainError.
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const result = await call(user, "get_proposal_stats", {});
    expect(result.isError).toBe(true);
    const row = await prisma.mcpToolCall.findFirstOrThrow();
    expect(row.ok).toBe(false);
  });
});

describe("prompt copies", () => {
  it("records the kind and the length, and ignores an unknown kind", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await recordPromptCopy(user.id, "advance_plan", 1234);
    await recordPromptCopy(user.id, "not_a_prompt", 99);
    await recordPromptCopy(user.id, "extract", -5);
    const rows = await prisma.claudePromptCopy.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.kind, r.chars])).toEqual([
      ["advance_plan", 1234],
      ["extract", 0],
    ]);
  });
});

describe("retention", () => {
  it("deletes what is past the retention and keeps the rest", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const now = new Date("2026-11-17T12:00:00Z");
    const old = new Date(now.getTime() - (CLAUDE_USAGE_RETENTION_DAYS + 1) * 86_400_000);
    const recent = new Date(now.getTime() - 86_400_000);
    const base = { userId: user.id, tool: "get_task", ok: true, resultBytes: 1, resultChars: 1, argsHash: "0000000000000000", durationMs: 1 };
    await prisma.mcpToolCall.createMany({ data: [{ ...base, createdAt: old }, { ...base, createdAt: recent }] });
    await prisma.claudePromptCopy.createMany({ data: [{ userId: user.id, kind: "extract", chars: 1, createdAt: old }] });

    expect(await pruneClaudeUsage(now)).toEqual({ toolCalls: 1, promptCopies: 1 });
    expect(await prisma.mcpToolCall.count()).toBe(1);
  });
});
