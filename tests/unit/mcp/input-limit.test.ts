import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { MAX_TOOL_INPUT_ELEMENTS } from "@/lib/mcp/limits";

// Security review, 25.10.2026: one request must not be able to exhaust the
// function's memory.
//
// GHSA-46jr-4wx8-v453 / CVE-2026-111768. The MCP SDK validated as many
// array elements and object members as a `tools/call` happened to carry,
// and zod (GHSA-mrhx-c7xc-m3w5, fixed in 4.6.6) collected one issue per
// failing element on top of that. A single authenticated POST, well under
// the body-size limit, was enough to end the function in "JavaScript heap
// out of memory". The per-token rate limit of 120 a minute is no defence
// against something that needs one request, and /api/mcp/portal is
// reachable by a client's portal user, not only by staff.
//
// The SDK's fix, `maxToolInputElements`, ships OFF by default, so the
// version bump alone would have left this open. lib/mcp/limits.ts turns it
// on, and has to pass it through a cast because mcp-handler types its
// options as the SDK's `ServerOptions`, which does not declare the field.
//
// That cast is why this file tests the running server rather than the
// types. A rename upstream, or mcp-handler no longer forwarding unknown
// options to `new McpServer`, would silently drop the limit and leave the
// code reading exactly as it does now. Here it goes red.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/mcp/auth", () => ({
  verifyMcpBearerToken: async () => ({
    token: "stub",
    clientId: "ankora-pat:stub",
    scopes: [],
    extra: { user: { id: "u1", role: "ANKORA_EMPLOYEE" } },
  }),
  actorFromAuthInfo: () => ({ id: "u1", role: "ANKORA_EMPLOYEE" }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  clientIpFrom: () => "127.0.0.1",
}));

/**
 * A request on the 2026-07-28 wire. `Mcp-Name` is not optional on a
 * tools/call: without it the transport refuses the request for a header
 * and body that disagree, long before any argument is counted, and this
 * file would pass for the wrong reason.
 */
function rpc(url: string, method: string, params: { name?: string } & Record<string, unknown> = {}) {
  return new Request(url, {
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

async function readAll(res: Response) {
  return await new Response(res.body).text();
}

/// Just over the ceiling, and nothing like the millions an attacker would
/// send: the point is that the server counts, not that it survives a real
/// attack, and a test that allocated a real attack payload would be the
/// slowest file in the suite.
const oversized = Array.from({ length: MAX_TOOL_INPUT_ELEMENTS + 1 }, (_, i) => String(i));

describe("an oversized tools/call payload is refused before it is parsed", () => {
  it("refuses it on the staff endpoint", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(
      rpc("https://www.ankora.co.il/api/mcp", "tools/call", {
        name: "propose_knowledge",
        arguments: { client: "Acme", newSource: { kind: "TRANSCRIPT", title: "t", participants: oversized } },
      })
    );
    const text = await readAll(res);

    expect(text).toContain(`maximum of ${MAX_TOOL_INPUT_ELEMENTS} elements`);
  });

  it("refuses it on the portal endpoint", async () => {
    // The portal has its own createMcpHandler call. The staff endpoint
    // passing says nothing about this one, and this one is the endpoint a
    // client's own Claude connects to.
    const { POST } = await import("@/app/api/mcp/portal/route");
    const res = await POST(
      rpc("https://www.ankora.co.il/api/mcp/portal", "tools/call", {
        name: "get_status",
        arguments: { padding: oversized },
      })
    );
    const text = await readAll(res);

    expect(text).toContain(`maximum of ${MAX_TOOL_INPUT_ELEMENTS} elements`);
  });

  it("leaves an ordinary call alone", async () => {
    // A guard on the guard. A limit that refused everything would make the
    // two assertions above pass while every connector broke, and "the
    // integration just will not connect" is a failure this codebase has
    // already had twice.
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(rpc("https://www.ankora.co.il/api/mcp", "tools/list"));
    const text = await readAll(res);

    expect(res.status).toBe(200);
    expect(text).toContain("list_my_clients");
    expect(text).not.toContain("maximum of");
  });
});
