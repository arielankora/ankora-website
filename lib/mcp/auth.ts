import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashMcpToken, looksLikeMcpToken, parseBearerToken } from "@/lib/mcp/token";

// Phase 13 (MCP server, docs/adr/0005): "who is making this MCP request,
// and are they still allowed to".
//
// This is the MCP counterpart of lib/app-auth/session.ts's
// getCurrentUser(), and it runs the SAME four checks that function runs -
// deliberately, one by one, rather than trusting the token row alone:
//
//   1. the token exists, is not revoked, and has not expired
//   2. the user row still exists and is not soft-deleted
//   3. the user's status is still ACTIVE
//   4. the user's tokenVersion has not moved past the token's snapshot
//
// Check 4 is the one that is easy to leave out and expensive to miss.
// Spec 4.2's "logout all sessions" works by bumping User.tokenVersion,
// which invalidates every issued JWT. If MCP tokens ignored that counter,
// an admin who revoked a departing employee's sessions would have locked
// them out of the browser while their Claude Desktop kept full read and
// write access to client data. So an MCP token records the tokenVersion it
// was issued under, and a "logout all sessions" kills it too.
//
// Note what is NOT here: no fallback to a shared secret, and no
// environment-variable API key. lib/cron-auth.ts has one of those, and it
// is correct there because a cron request represents the system rather
// than a person. Every MCP request represents a person - `assertCan`,
// `listAccessibleClients` and every AuditEvent depend on it - so a request
// with no resolvable user is a 401, never a degraded "system" identity.

export class McpUnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/// How stale McpAccessToken.lastUsedAt is allowed to get. Writing it on
/// every request would add a database write to every tool call for a field
/// nobody reads in real time; once every 15 minutes is plenty to answer
/// "is this token still in use / can I revoke it".
const LAST_USED_THROTTLE_MS = 15 * 60 * 1000;

/// Resolves a raw bearer token to the acting User, or null if any of the
/// four checks above fails. Callers must not distinguish between the
/// failure modes to the client: a token that is revoked, expired, or
/// belongs to a deactivated user all return the same 401, so an attacker
/// holding a stale token learns nothing about why it stopped working.
export async function resolveMcpActor(rawToken: string): Promise<User | null> {
  // Cheap shape check first: rejects a scanner spraying random bearer
  // values without touching Postgres at all.
  if (!looksLikeMcpToken(rawToken)) return null;

  const row = await prisma.mcpAccessToken.findUnique({
    where: { tokenHash: hashMcpToken(rawToken) },
    include: { user: true },
  });
  if (!row) return null;

  const now = new Date();
  if (row.revokedAt) return null;
  if (row.expiresAt <= now) return null;

  const user = row.user;
  if (!user || user.deletedAt) return null;
  if (user.status !== "ACTIVE") return null;
  if (user.tokenVersion !== row.tokenVersion) return null;

  // Throttled touch. Deliberately not awaited into the request's critical
  // path failure mode: if this write fails the request should still
  // succeed, because a bookkeeping column is not worth failing a user's
  // tool call over.
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await prisma.mcpAccessToken
      .update({ where: { id: row.id }, data: { lastUsedAt: now } })
      .catch((err: unknown) => {
        console.error("[mcp] failed to update lastUsedAt", err);
      });
  }

  return user;
}

/// The `verifyToken` callback handed to mcp-handler's `withMcpAuth`.
/// Returning undefined makes the handler answer 401 with the RFC 9728
/// `WWW-Authenticate` challenge; returning an AuthInfo lets the request
/// through with the acting user attached.
///
/// The resolved User rides along in `extra` so that tools do not re-query
/// it on every call. It never leaves the process: `extra` is server-side
/// request state, not part of any MCP response.
export async function verifyMcpBearerToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  const token = bearerToken ?? parseBearerToken(_req.headers.get("authorization"));
  if (!token) return undefined;

  const user = await resolveMcpActor(token);
  if (!user) return undefined;

  return {
    token,
    // There is no OAuth client in this phase - the token belongs directly
    // to a person. Phase 2 (real OAuth) replaces this with the registered
    // client id; nothing downstream reads it today.
    clientId: `ankora-pat:${user.id}`,
    scopes: [],
    extra: { user },
  };
}

/// Pulls the acting User back out of the tool-call context. Throws rather
/// than returning null: every tool is registered behind `withMcpAuth` with
/// `required: true`, so an absent user here means the route was wired
/// wrong, and failing loudly at the first tool call is better than
/// silently running a domain function with no actor.
export function actorFromAuthInfo(authInfo: AuthInfo | undefined): User {
  const user = authInfo?.extra?.user as User | undefined;
  if (!user) throw new McpUnauthorizedError();
  return user;
}
