import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerPortalTools } from "@/lib/mcp/portal-tools";
import { verifyMcpBearerToken } from "@/lib/mcp/auth";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { hashMcpToken, looksLikeMcpToken, parseBearerToken } from "@/lib/mcp/token";
import { isProductionBuild } from "@/lib/env";

// The client portal as an MCP server (NUX handover, 3.10.2026).
//
// /api/mcp is Ankora's staff surface; this endpoint is the portal's. A
// client's portal user adds it to their own Claude as a custom connector
// and asks "where do things stand", "what is waiting for me", "show me
// September's report" - and gets exactly what their portal shows, no
// more. lib/mcp/portal-tools.ts has the rules and why each holds.
//
// Same sign-in as the staff connector: the OAuth flow and the personal
// tokens in lib/mcp/auth.ts identify a PERSON, and what that person may
// see is decided per call from their role and memberships. A separate
// endpoint rather than one endpoint with two tool lists, because the
// tool list is fixed when the server is built, before the request's
// user is known - and a client's Claude should not be shown fourteen
// staff tools it is refused on every call.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler(registerPortalTools, {
  serverInfo: {
    name: "ankora-client-portal",
    version: "0.1.0",
  },
  // See app/api/mcp/route.ts: a stateless server has nothing to stream,
  // and an open SSE stream on a serverless function is a timeout loop.
  maxSubscriptions: 0,
  instructions: [
    "This server is the signed-in person's Ankora client portal: the work Ankora does for their company, as Ankora has chosen to show it to them.",
    "Identity and company come from the connection. You never pass a client or user, and you cannot see another company.",
    "Start with get_status for any 'where do things stand' question. Report progress with the counts the tools return rather than counting lists yourself.",
    "answer_decision records a final, signed answer. Read the options back, get an explicit choice from the user, and only then call it, once.",
    "Hours are billable hours as Ankora reports them. If something the user expects is missing, it may be work Ankora has not made visible on the portal; suggest they ask their Ankora account manager.",
  ].join(" "),
  verboseLogs: !isProductionBuild(),
});

// The 401 challenge names this resource's own discovery document, so a
// client probing it gets `resource: .../api/mcp/portal` back and its
// audience check matches the URL the user typed.
const authenticatedHandler = withMcpAuth(handler, verifyMcpBearerToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp/portal",
});

const MCP_RATE_LIMIT = 120;
const MCP_RATE_WINDOW_MS = 60_000;

/// Same buckets as the staff endpoint, keyed separately so a client's
/// Claude and an employee's never share a budget.
function rateLimitKey(req: Request): string {
  const token = parseBearerToken(req.headers.get("authorization"));
  if (token && looksLikeMcpToken(token)) {
    return `mcp-portal:tok:${hashMcpToken(token).slice(0, 32)}`;
  }
  return `mcp-portal:ip:${clientIpFrom(req.headers)}`;
}

async function rateLimitedHandler(req: Request): Promise<Response> {
  const result = await checkRateLimit(rateLimitKey(req), MCP_RATE_LIMIT, MCP_RATE_WINDOW_MS);
  if (!result.allowed) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      }
    );
  }
  return authenticatedHandler(req);
}

export { rateLimitedHandler as GET, rateLimitedHandler as POST };
