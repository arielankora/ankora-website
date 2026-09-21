import "server-only";
import { prisma } from "@/lib/prisma";
import { can, assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import type { User } from "@prisma/client";

// "Is Claude connected to this account, and to how many accounts across
// the company?" - the read side of the MCP server (docs/adr/0005) that
// Phase 15 never surfaced anywhere in the UI.
//
// Until now the only way to answer either question was a psql query. The
// grants existed, the OAuth flow worked, and nothing on any screen said
// so - which made a real, shipped capability effectively invisible to the
// people it was built for.
//
// The one rule this module follows: a connection is "live" here if and
// only if lib/mcp/auth.ts would still accept a token from it. Anything
// looser turns this into a screen that says "מחובר" next to a connection
// that 401s, which is worse than showing nothing. Concretely that means
// re-applying the same four checks, not trusting the token row alone:
//
//   1. the row is not revoked and has not rotated away (rotatedToId)
//   2. the credential has not expired
//   3. the user row still exists, is not soft-deleted, and is ACTIVE
//   4. the user's tokenVersion has not moved past the row's snapshot
//
// Check 4 is the one that matters most here, because it is exactly what
// "logout all sessions" moves: an admin who revokes a departing
// employee's sessions must see that person drop off this screen in the
// same instant, not keep reading "מחובר" from a dead grant.
//
// One deliberate difference from lib/mcp/auth.ts: liveness is judged on
// the REFRESH horizon, not the access-token one. An access token lives
// about an hour, so keying the badge to it would show "לא מחובר" for a
// connection that is perfectly healthy and simply idle since lunch. As
// long as the refresh token is valid, Claude can mint a new access token
// without the user doing anything - that is what "connected" means to a
// person looking at this screen.

export type ClaudeConnectionKind = "OAUTH" | "PAT";

export interface ClaudeGrantSummary {
  /// Prefixed so one opaque string identifies a row in either table:
  /// "oauth:<id>" or "pat:<id>". The alternative - passing a bare id plus
  /// a separate kind field through the form - lets a mismatched pair
  /// reach the server, and there is no good answer to "revoke id X, but
  /// as the other kind".
  id: string;
  kind: ClaudeConnectionKind;
  /// The OAuth client's registered name, or the personal-access-token
  /// label. Claude registers a fresh client per connection (RFC 7591), so
  /// two rows with the same name are two real connections, not a
  /// duplicate.
  label: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

export interface ClaudeConnectionStatus {
  connected: boolean;
  grants: ClaudeGrantSummary[];
  /// Most recent lastUsedAt across live grants - "when did Claude last
  /// actually call us as this person".
  lastUsedAt: Date | null;
}

export interface ClaudeOrgSummary {
  connectedUsers: number;
  eligibleUsers: number;
}

/// A user row is only counted when it would still authenticate. Mirrors
/// lib/mcp/auth.ts's checks 2-4 in one place so both call sites below
/// cannot drift apart.
type TokenUser = Pick<User, "id" | "status" | "deletedAt" | "tokenVersion">;

function userStillValid(user: TokenUser | null | undefined, rowTokenVersion: number): boolean {
  if (!user) return false;
  if (user.deletedAt) return false;
  if (user.status !== "ACTIVE") return false;
  return user.tokenVersion === rowTokenVersion;
}

const TOKEN_USER_SELECT = { id: true, status: true, deletedAt: true, tokenVersion: true } as const;

/// Live OAuth grants (the connector path - what Claude uses today).
///
/// `rotatedToId: null` is what keeps the count honest: refresh rotation
/// writes a NEW row and points the old one at it, so every connection
/// leaves a trail of superseded rows behind it. Counting those would make
/// one connector look like a dozen connections, growing every hour.
async function liveOAuthGrants(userId: string | null, now: Date) {
  const rows = await prisma.oAuthToken.findMany({
    where: {
      ...(userId ? { userId } : {}),
      revokedAt: null,
      rotatedToId: null,
      OR: [{ refreshExpiresAt: { gt: now } }, { refreshExpiresAt: null, accessExpiresAt: { gt: now } }],
    },
    select: {
      id: true,
      userId: true,
      clientId: true,
      tokenVersion: true,
      lastUsedAt: true,
      refreshExpiresAt: true,
      accessExpiresAt: true,
      client: { select: { clientName: true } },
      user: { select: TOKEN_USER_SELECT },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.filter((row) => userStillValid(row.user, row.tokenVersion));
}

/// Live personal access tokens (the legacy stdio bridge path). Kept in the
/// picture on purpose: someone still on the bridge IS connected, and a
/// screen that only knew about OAuth would tell them they are not.
async function livePatGrants(userId: string | null, now: Date) {
  const rows = await prisma.mcpAccessToken.findMany({
    where: {
      ...(userId ? { userId } : {}),
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      userId: true,
      tokenVersion: true,
      label: true,
      lastUsedAt: true,
      expiresAt: true,
      user: { select: TOKEN_USER_SELECT },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.filter((row) => userStillValid(row.user, row.tokenVersion));
}

function latest(dates: (Date | null)[]): Date | null {
  const real = dates.filter((d): d is Date => d instanceof Date);
  if (real.length === 0) return null;
  return real.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}

/// The acting user's OWN Claude connection. No permission gate - this is
/// self-service by definition, the same way /app/profile is: a person may
/// always see the state of their own credentials, and may never see
/// anyone else's through this function.
export async function getMyClaudeConnection(actor: User): Promise<ClaudeConnectionStatus> {
  const now = new Date();
  const [oauth, pats] = await Promise.all([liveOAuthGrants(actor.id, now), livePatGrants(actor.id, now)]);

  const grants: ClaudeGrantSummary[] = [
    ...oauth.map((row) => ({
      id: `oauth:${row.id}`,
      kind: "OAUTH" as const,
      label: row.client?.clientName || "Claude",
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.refreshExpiresAt ?? row.accessExpiresAt,
    })),
    ...pats.map((row) => ({
      id: `pat:${row.id}`,
      kind: "PAT" as const,
      label: row.label,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
    })),
  ];

  return {
    connected: grants.length > 0,
    grants,
    lastUsedAt: latest(grants.map((g) => g.lastUsedAt)),
  };
}

/// Company-wide adoption, for the Integrations screen. SUPER_ADMIN-only,
/// behind the same `integration.manage` permission that gates the screen
/// itself.
///
/// Returns counts and nothing else - deliberately. Naming which employees
/// have connected Claude would be a new disclosure of per-person tooling
/// on a screen that today reveals nothing about individuals, and no
/// decision on this screen needs it. A count answers the only real
/// question ("has this reached the team, or just me?") and stops there.
export async function getClaudeOrgSummary(actor: User): Promise<ClaudeOrgSummary | null> {
  if (!can(actor.role, "integration.manage")) return null;

  const now = new Date();
  const [oauth, pats, eligibleUsers] = await Promise.all([
    liveOAuthGrants(null, now),
    livePatGrants(null, now),
    prisma.user.count({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        // CLIENT_USER has no MCP surface worth counting - none of the ten
        // tools are reachable with that role - so including them would
        // deflate the ratio against a denominator that can never rise.
        role: { in: ["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE"] },
      },
    }),
  ]);

  const connectedUsers = new Set([...oauth.map((r) => r.userId), ...pats.map((r) => r.userId)]).size;

  return { connectedUsers, eligibleUsers };
}

// ---------------------------------------------------------------- revoking

// Until this existed, cutting Claude's access meant one of three things:
// removing the connector inside Claude (outside this system entirely),
// changing your own password, or an admin's "logout all sessions". All
// three work, and none of them is the thing an admin reaches for when
// someone leaves - that person wants one control, in this app, that says
// what it does and leaves a trail.
//
// Revocation here is a soft revoke (`revokedAt`), never a delete. The row
// is the evidence that the grant existed and when it ended; lib/mcp/auth.ts
// already treats a revoked row as a 401, so removing it would buy nothing
// and lose the audit trail. This also matches the schema's own
// "soft delete only" convention.
//
// There is deliberately no undo, which is a departure from the toast
// provider's rule that destructive actions offer one. Un-revoking would
// resurrect a credential the user just decided to kill, and the honest
// recovery path is the one that already exists: authorize again in Claude,
// which takes seconds and mints a fresh grant. So the safety lives in a
// confirmation step before the act, not in a reversal after it.

export type RevokeResult = { ok: true; revoked: number } | { ok: false; error: string };

/// How many live grants another user holds. Exists so the admin control
/// is not blind: a "disconnect Claude" button that looks identical
/// whether the person has three connections or none teaches an admin
/// nothing, and gets pressed on a hunch. Counts only - never labels,
/// never dates - for the same reason the org summary counts and stops.
export async function countClaudeGrantsForUser(actor: User, targetUserId: string): Promise<number> {
  assertCan(actor.role, "user.manage");
  const now = new Date();
  const [oauth, pats] = await Promise.all([liveOAuthGrants(targetUserId, now), livePatGrants(targetUserId, now)]);
  return oauth.length + pats.length;
}

function parseGrantId(grantId: string): { kind: ClaudeConnectionKind; id: string } | null {
  const [prefix, ...rest] = grantId.split(":");
  const id = rest.join(":");
  if (!id) return null;
  if (prefix === "oauth") return { kind: "OAUTH", id };
  if (prefix === "pat") return { kind: "PAT", id };
  return null;
}

/// Revokes ONE of the acting user's own grants.
///
/// Ownership is enforced inside the WHERE clause rather than by reading
/// the row first and comparing: an `updateMany` scoped to
/// `{ id, userId: actor.id }` cannot touch another person's row even if
/// the id is guessed or replayed, and it needs no second query to prove
/// it. A zero count means "no such grant of yours", which is the same
/// answer for a wrong id and for someone else's id - a caller learns
/// nothing about grants that are not theirs.
export async function revokeMyClaudeGrant(actor: User, grantId: string): Promise<RevokeResult> {
  const parsed = parseGrantId(grantId);
  if (!parsed) return { ok: false, error: "מזהה חיבור לא תקין." };

  const now = new Date();
  let revoked = 0;

  if (parsed.kind === "OAUTH") {
    // Revoke every live row this user holds for the SAME OAuth client, not
    // only the current one in the rotation chain. Rotation normally revokes
    // the row it supersedes, but a row that was rotated away and not yet
    // revoked would otherwise keep a valid access token alive for up to an
    // hour after the person pressed "disconnect" - and "disconnect" has to
    // mean disconnected.
    const row = await prisma.oAuthToken.findFirst({
      where: { id: parsed.id, userId: actor.id },
      select: { clientId: true },
    });
    if (!row) return { ok: false, error: "החיבור לא נמצא." };

    const result = await prisma.oAuthToken.updateMany({
      where: { userId: actor.id, clientId: row.clientId, revokedAt: null },
      data: { revokedAt: now },
    });
    revoked = result.count;
  } else {
    const result = await prisma.mcpAccessToken.updateMany({
      where: { id: parsed.id, userId: actor.id, revokedAt: null },
      data: { revokedAt: now },
    });
    revoked = result.count;
  }

  if (revoked === 0) return { ok: false, error: "החיבור לא נמצא, או שכבר נותק." };

  await recordAudit({
    actorId: actor.id,
    action: "mcp_grant.revoke",
    entityType: "McpGrant",
    entityId: grantId,
    after: { kind: parsed.kind, rowsRevoked: revoked, self: true },
  });

  return { ok: true, revoked };
}

/// Revokes every live Claude grant belonging to another user.
///
/// Gated on `user.manage` - the same permission behind "logout all
/// sessions", which it sits next to on the user detail screen and which
/// an admin already reaches for in exactly this situation. Deliberately
/// all-or-nothing rather than per-grant: an admin cutting off a departing
/// employee wants access gone, not a list of laptops to work through.
///
/// Note this does NOT bump tokenVersion. "Logout all sessions" is the
/// blunter instrument and remains available beside it; this one cuts
/// Claude without also throwing the person out of every browser tab,
/// which is the right default when the reason is "they no longer need
/// this integration" rather than "this account may be compromised".
export async function revokeClaudeGrantsForUser(actor: User, targetUserId: string): Promise<RevokeResult> {
  assertCan(actor.role, "user.manage");
  if (!targetUserId) return { ok: false, error: "לא צוין משתמש." };

  const now = new Date();
  const [oauth, pats] = await Promise.all([
    prisma.oAuthToken.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.mcpAccessToken.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: now } }),
  ]);

  const revoked = oauth.count + pats.count;

  // Recorded even when nothing was live. "An admin cut this person's
  // Claude access off" is a fact worth keeping whether or not there
  // happened to be a grant to cut - the absence of a row would otherwise
  // read as "nobody ever tried".
  await recordAudit({
    actorId: actor.id,
    action: "mcp_grant.revoke_all",
    entityType: "User",
    entityId: targetUserId,
    after: { oauthRevoked: oauth.count, patRevoked: pats.count },
  });

  return { ok: true, revoked };
}
