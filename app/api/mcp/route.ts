import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerAnkoraTools } from "@/lib/mcp/tools";
import { verifyMcpBearerToken } from "@/lib/mcp/auth";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { hashMcpToken, looksLikeMcpToken, parseBearerToken } from "@/lib/mcp/token";

// Phase 13 (MCP server, docs/adr/0005). The Model Context Protocol
// endpoint that lets an Ankora employee reach the Time Tracking app from
// their own Claude Desktop.
//
// It sits inside this app rather than in a service of its own for the
// reason docs/adr/0005 records: lib/app-domain/* is `server-only` and
// imports Prisma directly, so a separate service would have to either
// duplicate that layer or grow a REST API in front of it first. Living
// here, the MCP surface inherits lib/app-auth/permissions.ts, the
// UserClientAccess scoping, the AuditEvent trail and the billing policy
// with no second implementation to keep in step.
//
// Phase 1 authenticates with a per-user personal access token (see
// lib/mcp/auth.ts). Claude Desktop reaches it through the small stdio
// bridge in scripts/mcp-bridge.mjs, which holds the employee's token and
// forwards JSON-RPC here. Phase 2 adds a real OAuth authorization server
// so the same endpoint can be added as a Claude custom connector without
// a local bridge; `withMcpAuth` already emits the RFC 9728 401 challenge
// that flow needs, so nothing about this file changes when it lands.

// Prisma needs the Node runtime - it does not run on the Edge runtime.
export const runtime = "nodejs";

// Every request carries a per-user bearer token, so there is nothing here
// that could ever be statically rendered or cached.
export const dynamic = "force-dynamic";

// A tool call runs one or two domain queries. 60s is generous and well
// inside Vercel's limit; it exists so a pathological query fails as a
// timeout rather than hanging a user's Claude session.
export const maxDuration = 60;

const handler = createMcpHandler(registerAnkoraTools, {
  serverInfo: {
    name: "ankora-time-tracking",
    version: "0.1.0",
  },
  // Read by the model before it picks a tool. Worth as much care as the
  // tool descriptions themselves: the two rules below are the ones that
  // stop the most common failure modes - inventing an id, and assuming a
  // write succeeded.
  instructions: [
    "This server exposes Ankora's Time Tracking app for the signed-in employee.",
    "Identity comes from the connection, not from arguments: you never pass a user id, and you cannot act as anyone else.",
    "Never invent an Ankora id. Call list_my_clients and list_categories first and use the names they return exactly as written; if a name does not resolve, ask the user rather than guessing.",
    "Reading another person's time needs a manager or admin role. If a team tool is refused, say so plainly instead of retrying.",
    "Writes create real records that colleagues and clients see. Confirm the client, category and times with the user before calling a write tool, and never call create_time_entry twice for the same work - it makes two entries.",
  ].join(" "),
  verboseLogs: process.env.NODE_ENV !== "production",
});

// `required: true` means an unauthenticated request is refused outright
// rather than falling through to the tools with no actor attached. Every
// tool then reads its User from the verified AuthInfo - see
// actorFromAuthInfo in lib/mcp/auth.ts.
const authenticatedHandler = withMcpAuth(handler, verifyMcpBearerToken, {
  required: true,
});

/// Requests allowed per token (or per IP, for junk tokens) per window. An
/// agent loop that goes wrong calls a tool in a tight cycle, so this is
/// about protecting the database from one misbehaving client rather than
/// about abuse: a human-paced session is nowhere near 120 calls a minute.
const MCP_RATE_LIMIT = 120;
const MCP_RATE_WINDOW_MS = 60_000;

/// Keyed on the token's hash when one is present, so each employee gets
/// their own budget instead of the whole Tel Aviv office sharing one
/// office-IP bucket. Anything without a well-formed token falls back to
/// the IP bucket, which is what throttles a scanner spraying bearer
/// values before it can reach Postgres at all.
///
/// The hash - never the raw token - is what goes into the key, because
/// rate-limit keys reach Redis and, on failure paths, logs.
function rateLimitKey(req: Request): string {
  const token = parseBearerToken(req.headers.get("authorization"));
  if (token && looksLikeMcpToken(token)) {
    return `mcp:tok:${hashMcpToken(token).slice(0, 32)}`;
  }
  return `mcp:ip:${clientIpFrom(req.headers)}`;
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
