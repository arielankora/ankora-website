import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";

// Phase 13 (MCP server, docs/adr/0005) - this endpoint must never hold a
// stream open.
//
// A regression guard with a receipt. In the seventeen hours after
// /app/integrations started inviting people to connect Claude, /api/mcp
// logged 362 "Task timed out after 60 seconds" errors across 26 users, and
// every one was a `subscriptions/listen` stream. The 2026-07-28 revision
// lets a client open an SSE stream for server-initiated notifications; the
// SDK allows 1024 of them by default and keep-alives each one, so it never
// idles out. On a serverless function the platform kills it at maxDuration,
// the client reads a stream that closed without a result as a disconnect -
// the SDK's own comment says exactly that - and reconnects. Round and round.
//
// Not one notification could ever have arrived. mcp-handler serves this
// endpoint with `legacy: "stateless"`, which builds a fresh McpServer per
// request, so nothing outlives a response to emit into a stream; and this
// server registers tools only, with no resources, prompts or subscribable
// anything. The stream was structurally incapable of carrying an event.
//
// The failure mode is what earns this file. Raising the limit back breaks no
// other assertion in the repo: the damage is a Vercel bill and a runtime log
// too noisy to find a real 500 in, which is how a genuine Hebrew-export 500
// sat unnoticed for a week underneath it. Nothing goes red on its own.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// Auth and rate limiting have their own suites. Both are stubbed to the
// success path so the only thing under test here is the response shape.
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
 * A request on the 2026-07-28 wire, which is the only wire that has
 * `subscriptions/listen` at all - a plain 2025-style POST is answered
 * "Method not found" and never reaches the subscription path. Getting
 * there needs all four parts: the protocol-version header, the matching
 * `Mcp-Method` header, and the `_meta` envelope naming the revision and
 * the client. Miss any one and the SDK refuses the request for that
 * reason instead, which would make this test pass for the wrong cause.
 */
function modernRpc(method: string, params: Record<string, unknown> = {}) {
  return new Request("https://www.ankora.co.il/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer stub",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
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

/**
 * Read a response body to the end, or give up.
 *
 * `ended` is the assertion this file exists for, and it is the only honest
 * one: the content type does not distinguish the two cases, because this
 * transport answers an ordinary error over `text/event-stream` too when the
 * client accepts it. What separates a refusal from the bug is whether the
 * body ever finishes. Measured against a deadline far below the real
 * 60-second maxDuration, so a test that fails, fails fast.
 */
async function drain(res: Response, budgetMs = 2000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const started = Date.now();
  let text = "";
  const deadline = new Promise<"open">((resolve) => setTimeout(() => resolve("open"), budgetMs));

  for (;;) {
    const step = await Promise.race([reader.read(), deadline]);
    if (step === "open") {
      await reader.cancel();
      return { ended: false, ms: Date.now() - started, text };
    }
    if (step.done) return { ended: true, ms: Date.now() - started, text };
    text += decoder.decode(step.value, { stream: true });
  }
}

describe("/api/mcp never holds a stream open", () => {
  it("refuses subscriptions/listen instead of opening one", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    // `notifications` is REQUIRED on a listen request, and asking for the
    // one notification this server could plausibly honour keeps the test
    // about the subscription limit rather than about params validation.
    const res = await POST(modernRpc("subscriptions/listen", { notifications: { toolsListChanged: true } }));
    const body = await drain(res);

    expect(body.ended, "the response body never finished: this endpoint is holding a stream open").toBe(true);
    expect(body.text).toContain("Subscription limit reached");
    // Without maxSubscriptions: 0 the first frame is this, and then silence
    // until the platform kills the function.
    expect(body.text).not.toContain("subscriptions/acknowledged");
  });

  it("still answers tools/list, so the refusal is narrow", async () => {
    // A guard on the guard. If a future SDK made maxSubscriptions: 0 reject
    // everything, the test above would keep passing while every connector
    // broke - and "the integration just won't connect" is the failure this
    // codebase has already had twice.
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(modernRpc("tools/list"));
    const body = await drain(res);

    expect(body.ended).toBe(true);
    expect(res.status).toBe(200);
    expect(body.text).toContain("list_my_clients");
    expect(body.text).not.toContain("Subscription limit reached");
  });
});
