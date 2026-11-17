import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { canonicalDefinitions, listToolDefinitions, toolDefinitionsHash, type ToolDefinition } from "@/lib/mcp/tool-definitions";
import { registerAnkoraTools } from "@/lib/mcp/tools";
import { registerPortalTools } from "@/lib/mcp/portal-tools";

// 17.11.2026: Claude Desktop asks the user to allow a tool again whenever
// its definition (name, title, description, inputSchema, annotations)
// changes. Over the 30 days before this file, propose_knowledge alone
// changed in 21 deploys, and 62 deploys changed some tool.
//
// The snapshot files next to this test hold every definition each endpoint
// publishes, exactly as tools/list sends it. A change to any of them fails
// here until the snapshot is updated on purpose (npx vitest run
// tests/unit/mcp/tool-definitions.test.ts -u), so the change is visible in
// the pull request's diff: name the changed tools in its description, and
// leave a definition alone when the change gives Claude nothing new.
//
// The same test holds serverInfo.version to a hash of those definitions
// (lib/mcp/server-version.ts), so it changes only when they do.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mcp/auth", () => ({
  verifyMcpBearerToken: async () => ({ token: "stub", clientId: "ankora-pat:stub", scopes: [], extra: { user: { id: "u1", role: "ANKORA_EMPLOYEE" } } }),
  actorFromAuthInfo: () => ({ id: "u1", role: "ANKORA_EMPLOYEE" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  clientIpFrom: () => "127.0.0.1",
}));

type Post = (req: Request) => Promise<Response>;

/// The fields a definition may carry. Anything else on a published tool
/// (outputSchema, _meta, icons, execution) is not in the hash or the
/// snapshot yet, so it must not appear unnoticed.
const KNOWN_FIELDS = new Set(["name", "title", "description", "inputSchema", "annotations"]);

function request(url: string, method: string, params: Record<string, unknown>, protocol: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer stub",
      "mcp-protocol-version": protocol,
      "mcp-method": method,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function body(res: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const text = await res.text();
  // Plain JSON, or one server-sent event carrying it.
  const json = text.trim().startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))!.slice(5);
  return JSON.parse(json);
}

const META = {
  [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
  [CLIENT_INFO_META_KEY]: { name: "ankora-qa", version: "1" },
  [CLIENT_CAPABILITIES_META_KEY]: {},
};

async function publishedTools(POST: Post, url: string): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  let cursor: string | undefined;
  do {
    const reply = await body(await POST(request(url, "tools/list", { ...(cursor ? { cursor } : {}), _meta: META }, "2026-07-28")));
    if (!reply.result) throw new Error(`tools/list failed: ${JSON.stringify(reply.error)}`);
    tools.push(...(reply.result.tools as ToolDefinition[]));
    cursor = reply.result.nextCursor as string | undefined;
  } while (cursor);
  return tools;
}

async function serverVersion(POST: Post, url: string): Promise<string> {
  const reply = await body(
    await POST(
      request(url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ankora-qa", version: "1" } }, "2025-06-18"),
    ),
  );
  if (!reply.result) throw new Error(`initialize failed: ${JSON.stringify(reply.error)}`);
  return (reply.result.serverInfo as { version: string }).version;
}

const ENDPOINTS = [
  {
    path: "/api/mcp",
    url: "https://www.ankora.co.il/api/mcp",
    route: () => import("@/app/api/mcp/route"),
    register: registerAnkoraTools,
    snapshot: "./__snapshots__/tool-definitions.api-mcp.json",
  },
  {
    path: "/api/mcp/portal",
    url: "https://www.ankora.co.il/api/mcp/portal",
    route: () => import("@/app/api/mcp/portal/route"),
    register: registerPortalTools,
    snapshot: "./__snapshots__/tool-definitions.api-mcp-portal.json",
  },
];

describe.each(ENDPOINTS)("tool definitions of $path", ({ url, route, register, snapshot }) => {
  it("match the snapshot, so a changed definition is a reviewed change", async () => {
    const { POST } = await route();
    const published = await publishedTools(POST as Post, url);
    await expect(`${JSON.stringify(canonicalDefinitions(published), null, 2)}\n`).toMatchFileSnapshot(snapshot);
  });

  it("carry no field the snapshot and the version leave out", async () => {
    const { POST } = await route();
    const published = await publishedTools(POST as Post, url);
    const extra = published.flatMap((tool) =>
      Object.entries(tool)
        .filter(([key, value]) => !KNOWN_FIELDS.has(key) && value !== undefined)
        .map(([key]) => `${tool.name}.${key}`),
    );
    expect(extra).toEqual([]);
  });

  it("are read without a request exactly as tools/list publishes them", async () => {
    const { POST } = await route();
    const published = await publishedTools(POST as Post, url);
    expect(canonicalDefinitions(listToolDefinitions(register as never))).toEqual(canonicalDefinitions(published));
  });

  it("set serverInfo.version, which changes only when they change", async () => {
    const { POST } = await route();
    const published = await publishedTools(POST as Post, url);
    expect(await serverVersion(POST as Post, url)).toBe(`0.1.0+${toolDefinitionsHash(published)}`);
  });
});

describe("toolDefinitionsHash", () => {
  const tool: ToolDefinition = { name: "t", description: "d", inputSchema: { type: "object", properties: { a: { type: "string" } } } };

  it("does not depend on key order", () => {
    const reordered: ToolDefinition = { inputSchema: { properties: { a: { type: "string" } }, type: "object" }, description: "d", name: "t" };
    expect(toolDefinitionsHash([reordered])).toBe(toolDefinitionsHash([tool]));
  });

  it("changes when a description changes", () => {
    expect(toolDefinitionsHash([{ ...tool, description: "d." }])).not.toBe(toolDefinitionsHash([tool]));
  });

  it("does not depend on the date, the time zone or the deploy", () => {
    const before = toolDefinitionsHash(listToolDefinitions(registerAnkoraTools as never));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-02-28T23:30:00Z"));
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "deadbeefcafe");
    vi.stubEnv("VERCEL_URL", "elsewhere.vercel.app");
    try {
      expect(toolDefinitionsHash(listToolDefinitions(registerAnkoraTools as never))).toBe(before);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
