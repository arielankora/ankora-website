import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";

// 31.10.2026, RIMED: propose_knowledge refused every item with "חסר
// סטטוס", because the schema the tool published had no status field. A
// client that followed the schema could send nothing. This file reads the
// schema the running server publishes (tools/list), not the source, so a
// field that is declared but never reaches the client goes red here.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mcp/auth", () => ({
  verifyMcpBearerToken: async () => ({ token: "stub", clientId: "ankora-pat:stub", scopes: [], extra: { user: { id: "u1", role: "ANKORA_EMPLOYEE" } } }),
  actorFromAuthInfo: () => ({ id: "u1", role: "ANKORA_EMPLOYEE" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  clientIpFrom: () => "127.0.0.1",
}));

function toolsList() {
  return new Request("https://www.ankora.co.il/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer stub",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "ankora-qa", version: "1" },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });
}

type JsonSchema = { properties?: Record<string, JsonSchema>; items?: JsonSchema; enum?: string[]; description?: string };

async function publishedTool(name: string): Promise<{ description: string; inputSchema: JsonSchema }> {
  const { POST } = await import("@/app/api/mcp/route");
  const text = await new Response((await POST(toolsList())).body).text();
  // Plain JSON, or one server-sent event carrying it.
  const json = text.trim().startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))!.slice(5);
  const tool = (JSON.parse(json).result.tools as { name: string; description: string; inputSchema: JsonSchema }[]).find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not published`);
  return tool;
}

describe("propose_knowledge, as tools/list publishes it", () => {
  it("has status on each item, with the three values", async () => {
    const tool = await publishedTool("propose_knowledge");
    const item = tool.inputSchema.properties!.items.items!;
    expect(item.properties!.status.enum).toEqual(["CONFIRMED", "UNCERTAIN", "MISSING"]);
    expect(item.properties!.status.description).toContain("CONFIRMED");
  });

  it("explains status near the start of the description, where a client that cuts it still reads it", async () => {
    const { description } = await publishedTool("propose_knowledge");
    const at = description.indexOf("STATUS");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(600);
  });
});
