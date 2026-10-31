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
// A tools/call below must reach the tool's own code, and stop there.
vi.mock("@/lib/mcp/lookup", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  lookupClient: async () => ({ ok: false, message: "REACHED_THE_TOOL" }),
}));
vi.mock("@/lib/mcp/auth", () => ({
  verifyMcpBearerToken: async () => ({ token: "stub", clientId: "ankora-pat:stub", scopes: [], extra: { user: { id: "u1", role: "ANKORA_EMPLOYEE" } } }),
  actorFromAuthInfo: () => ({ id: "u1", role: "ANKORA_EMPLOYEE" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  clientIpFrom: () => "127.0.0.1",
}));

function toolsList() {
  return rpc("tools/list");
}

function rpc(method: string, params: { name?: string } & Record<string, unknown> = {}) {
  return new Request("https://www.ankora.co.il/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer stub",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(params.name ? { "mcp-name": params.name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "ankora-qa", version: "1" },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });
}

type JsonSchema = { properties?: Record<string, JsonSchema>; items?: JsonSchema; enum?: string[]; description?: string; title?: string; anyOf?: JsonSchema[] };

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

// 31.10.2026, RIMED, the second round: status was there, but `payload` was
// published as an open object, so FACT.topic (and every other closed list
// inside a payload) never reached the client, and an item was dropped for
// a value it could not have known. And the description ran to 11,000
// characters; the client cut it near 4,000.

/** The published payload variant of one target. */
async function publishedPayload(target: string): Promise<JsonSchema> {
  const tool = await publishedTool("propose_knowledge");
  const variants = tool.inputSchema.properties!.items.items!.properties!.payload.anyOf!;
  const v = variants.find((x) => x.title === target);
  if (!v) throw new Error(`no published payload for ${target}`);
  return v;
}

/** Every enum in a JSON Schema, by path. */
function enumsIn(node: JsonSchema | undefined, path = "", out: Record<string, string[]> = {}): Record<string, string[]> {
  if (!node) return out;
  if (node.enum) out[path] = node.enum;
  for (const [k, v] of Object.entries(node.properties ?? {})) enumsIn(v, path ? `${path}.${k}` : k, out);
  if (node.items) enumsIn(node.items, `${path}[]`, out);
  for (const v of node.anyOf ?? []) enumsIn(v, path, out);
  return out;
}

const DESCRIPTION_LIMIT = 3500;

describe("propose_knowledge payloads, as tools/list publishes them", () => {
  it("publishes FACT.topic with its eight values", async () => {
    const fact = await publishedPayload("FACT");
    expect(fact.properties!.topic.enum).toEqual(["COMMUNICATION", "REPORTING", "DOCUMENTS", "AUTOMATION", "ADMINS", "PAYMENTS", "SUPPLIERS", "OTHER"]);
    expect(fact.properties!.kind.enum).toContain("PREFERENCE");
  });

  it("publishes a payload for every target the server takes", async () => {
    const { PAYLOADS } = await import("@/lib/knowledge-proposals");
    for (const target of Object.keys(PAYLOADS)) await expect(publishedPayload(target)).resolves.toBeTruthy();
  });

  it("publishes every closed list the server validates a payload with, with the same values", async () => {
    // One source: the published lists come from PAYLOADS. A list dropped on
    // the way (or a field renamed in one place) goes red here.
    const { PROPOSAL_TARGETS, payloadEnums } = await import("@/lib/mcp/proposal-schema");
    for (const target of PROPOSAL_TARGETS) {
      const published = enumsIn(await publishedPayload(target));
      for (const [path, values] of Object.entries(payloadEnums(target))) {
        // On the item as `status`, checked in the first describe.
        if (path === "knowledgeStatus") continue;
        expect(published[path], `${target}.${path}`).toEqual(values);
      }
    }
  });

  it("publishes the lists the server filters POLICY params and step tags by", async () => {
    const { ACTION_TAGS, CHANNELS } = await import("@/lib/process-rules");
    const policy = enumsIn(await publishedPayload("POLICY"));
    expect(policy["params.appliesToTags[]"]).toEqual([...ACTION_TAGS]);
    expect(policy["params.channels[]"]).toEqual([...CHANNELS]);
    expect(policy["interimParams.appliesToTags[]"]).toEqual([...ACTION_TAGS]);
    expect(enumsIn(await publishedPayload("PROCESS"))["steps[].actionTags[]"]).toEqual([...ACTION_TAGS]);
  });

  it("does not publish what the client must not send", async () => {
    expect((await publishedPayload("NARRATIVE")).properties).not.toHaveProperty("baseVersion");
    expect((await publishedPayload("FACT")).properties).not.toHaveProperty("knowledgeStatus");
  });

  it("matches the snapshot", async () => {
    // A change here is a change to what every connected Claude sees. Look
    // at the diff before updating it (vitest -u).
    const tool = await publishedTool("propose_knowledge");
    expect(tool.inputSchema).toMatchSnapshot();
  });

  it("keeps the description short enough not to be cut, with STATUS and the FACT topics in it", async () => {
    const { description } = await publishedTool("propose_knowledge");
    expect(description.length).toBeLessThan(DESCRIPTION_LIMIT);
    expect(description.indexOf("STATUS")).toBeLessThan(400);
    expect(description).toContain("COMMUNICATION, REPORTING, DOCUMENTS, AUTOMATION, ADMINS, PAYMENTS, SUPPLIERS, OTHER");
    expect(description).not.toMatch(/[\u2013\u2014]/);
  });

  it("still lets a payload with a bad value through to the tool, which drops that item alone", async () => {
    // The published schema says more than the call is validated with. If
    // the SDK refused the whole call for one bad topic, one item would
    // cost the batch.
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(
      rpc("tools/call", {
        name: "propose_knowledge",
        arguments: { client: "RIMED", sourceCode: "S15", items: [{ target: "FACT", payload: { kind: "PREFERENCE", body: "x", topic: "NOT_A_TOPIC" }, reason: "r" }] },
      })
    );
    const text = await new Response(res.body).text();
    expect(text).toContain("REACHED_THE_TOOL");
  });
});
