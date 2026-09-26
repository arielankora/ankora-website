import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  hashCredential,
  looksLikeAuthorizationCode,
  looksLikeOAuthAccessToken,
  looksLikeRefreshToken,
  newAccessToken,
  newAuthorizationCode,
  newClientId,
  newRefreshToken,
  secondsFromNow,
} from "@/lib/mcp/oauth/pkce";
import { isRegisterableRedirectUri } from "@/lib/mcp/oauth/redirect";

// Phase 15 (MCP OAuth, docs/adr/0005): every row the authorization server
// reads or writes.
//
// Kept apart from the endpoints so each route handler is thin protocol
// translation and the state transitions that actually matter - consuming
// a code exactly once, rotating a refresh token exactly once - live in one
// place where they can be reasoned about together.
//
// Only hashes are stored, for every credential kind. Same principle as
// PasswordResetToken and McpAccessToken.

export type RegisteredClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  scopes: string[];
};

/// The scopes this server understands. Deliberately one: the MCP surface
/// is not partitioned by scope, because the real authorisation happens
/// per-call in lib/app-auth/permissions.ts against the user's own role.
/// A second scope here would imply a second answer to "may this user do
/// X", which is exactly the duplication ADR 0005 exists to avoid.
export const SUPPORTED_SCOPES = ["mcp", "offline_access"] as const;
export const DEFAULT_SCOPE = "mcp offline_access";

export function normalizeScope(requested: string | null | undefined): string {
  if (!requested) return DEFAULT_SCOPE;
  const granted = requested
    .split(/\s+/)
    .filter((s) => (SUPPORTED_SCOPES as readonly string[]).includes(s));
  return granted.length ? Array.from(new Set(granted)).join(" ") : "mcp";
}

// ------------------------------------------------------------ registration

/// Dynamic Client Registration (RFC 7591).
///
/// Claude registers a PUBLIC client - no secret, PKCE instead - so no
/// secret is minted here. The caller-supplied redirect URIs are filtered
/// through isRegisterableRedirectUri first: registration is the gate,
/// because anything stored here can later receive an authorization code.
export async function registerClient(input: {
  clientName?: string;
  redirectUris: string[];
  grantTypes?: string[];
  scopes?: string;
}): Promise<RegisteredClient | { error: string; description: string }> {
  const redirectUris = input.redirectUris.filter(isRegisterableRedirectUri);
  if (redirectUris.length === 0) {
    return {
      error: "invalid_redirect_uri",
      description:
        "At least one redirect_uri must be an https URI, or an http URI on localhost or 127.0.0.1.",
    };
  }
  if (redirectUris.length !== input.redirectUris.length) {
    // Partial acceptance would silently register fewer URIs than the
    // client believes it has, and the flow would then fail later with a
    // confusing redirect_uri mismatch. Fail now, loudly.
    return {
      error: "invalid_redirect_uri",
      description: "One or more redirect_uris use a scheme or form this server does not accept.",
    };
  }

  const grantTypes = (input.grantTypes?.length
    ? input.grantTypes
    : ["authorization_code", "refresh_token"]
  ).filter((g) => g === "authorization_code" || g === "refresh_token");

  const client = await prisma.oAuthClient.create({
    data: {
      clientId: newClientId(),
      clientName: input.clientName?.slice(0, 200) || "Unnamed MCP client",
      redirectUris,
      grantTypes,
      scopes: normalizeScope(input.scopes).split(" "),
    },
  });

  return {
    clientId: client.clientId,
    clientName: client.clientName,
    redirectUris: client.redirectUris,
    grantTypes: client.grantTypes,
    scopes: client.scopes,
  };
}

export async function getClient(clientId: string): Promise<RegisteredClient | null> {
  if (!clientId) return null;
  const client = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (!client) return null;
  return {
    clientId: client.clientId,
    clientName: client.clientName,
    redirectUris: client.redirectUris,
    grantTypes: client.grantTypes,
    scopes: client.scopes,
  };
}

// ----------------------------------------------------------------- codes

export async function createAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
}): Promise<string> {
  const raw = newAuthorizationCode();
  await prisma.oAuthAuthorizationCode.create({
    data: {
      codeHash: hashCredential(raw),
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scope: input.scope,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      resource: input.resource,
      expiresAt: secondsFromNow(AUTHORIZATION_CODE_TTL_SECONDS),
    },
  });
  return raw;
}

export type ConsumedCode = {
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
};

/// Consumes a code exactly once.
///
/// The `updateMany ... where consumedAt: null` is the whole point: it is a
/// single atomic statement, so two simultaneous exchanges of the same code
/// cannot both see it unconsumed. A read-then-write would race, and the
/// race is exactly what an attacker replaying a stolen code would try.
export async function consumeAuthorizationCode(rawCode: string): Promise<ConsumedCode | null> {
  if (!looksLikeAuthorizationCode(rawCode)) return null;
  const codeHash = hashCredential(rawCode);

  const claimed = await prisma.oAuthAuthorizationCode.updateMany({
    where: { codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  const row = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash } });
  if (!row) return null;
  return {
    clientId: row.clientId,
    userId: row.userId,
    redirectUri: row.redirectUri,
    scope: row.scope,
    codeChallenge: row.codeChallenge,
    codeChallengeMethod: row.codeChallengeMethod,
    resource: row.resource,
  };
}

// ---------------------------------------------------------------- tokens

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

export async function issueTokens(input: {
  clientId: string;
  userId: string;
  scope: string;
  resource: string | null;
  tokenVersion: number;
}): Promise<IssuedTokens> {
  const accessToken = newAccessToken();
  const refreshToken = newRefreshToken();

  await prisma.oAuthToken.create({
    data: {
      clientId: input.clientId,
      userId: input.userId,
      accessTokenHash: hashCredential(accessToken),
      refreshTokenHash: hashCredential(refreshToken),
      scope: input.scope,
      resource: input.resource,
      // Snapshotted for the same reason McpAccessToken snapshots it: a
      // later "logout all sessions" must revoke this grant too.
      tokenVersion: input.tokenVersion,
      accessExpiresAt: secondsFromNow(ACCESS_TOKEN_TTL_SECONDS),
      refreshExpiresAt: secondsFromNow(REFRESH_TOKEN_TTL_SECONDS),
    },
  });

  await prisma.oAuthClient
    .update({ where: { clientId: input.clientId }, data: { lastUsedAt: new Date() } })
    .catch((err: unknown) => console.error("[mcp-oauth] client lastUsedAt failed", err));

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, scope: input.scope };
}

export type RefreshOutcome =
  | { ok: true; tokens: IssuedTokens }
  | { ok: false; error: "invalid_grant"; description: string };

/// How long a rotated grant keeps working for callers that raced the
/// rotation.
///
/// Claude runs a connector from several places at once (the chat, Cowork
/// sessions, scheduled tasks), and they share ONE stored grant. When two of
/// them notice an expiring token at the same moment, both refresh. Before
/// this window existed the rotation revoked the old row outright, which did
/// two things at once: it killed the access token the other caller was
/// still using mid-request, and it turned the other caller's refresh into a
/// "reuse" that revoked the whole grant. The result was a loop of 401s on
/// /api/mcp immediately after successful token exchanges, ending with the
/// connector marked as needing re-authorization.
///
/// Inside this window a rotated refresh token is treated as a benign race,
/// not a breach: it is exchanged for a fresh pair, and the previous access
/// token stays valid until the window closes. Outside it, reuse is still a
/// breach signal and still revokes the grant.
export const ROTATION_GRACE_SECONDS = 60;

/// Exchanges a refresh token for a new pair, rotating it.
///
/// Rotation is required for public clients by the MCP authorization spec.
/// REUSE of an already-rotated refresh token outside ROTATION_GRACE_SECONDS
/// is treated as a breach signal and revokes the whole grant for that user
/// and client: after the grace window, a replay means the token leaked.
///
/// Rotation deliberately does NOT set `revokedAt` on the old row. That
/// column means "this grant was revoked" (reuse, disconnect, logout all
/// sessions) and it also kills the row's access token. Rotation instead
/// ends the refresh token (`refreshExpiresAt = now`) and shortens the old
/// access token to the grace window.
export async function rotateRefreshToken(rawRefresh: string, clientId: string): Promise<RefreshOutcome> {
  if (!looksLikeRefreshToken(rawRefresh)) {
    return { ok: false, error: "invalid_grant", description: "Malformed refresh token." };
  }
  const refreshTokenHash = hashCredential(rawRefresh);
  const row = await prisma.oAuthToken.findUnique({
    where: { refreshTokenHash },
    include: { user: true },
  });
  if (!row || row.clientId !== clientId) {
    return { ok: false, error: "invalid_grant", description: "Unknown refresh token." };
  }

  const now = new Date();
  if (row.revokedAt) {
    return { ok: false, error: "invalid_grant", description: "Refresh token expired or revoked." };
  }

  const user = row.user;
  if (!user || user.deletedAt || user.status !== "ACTIVE" || user.tokenVersion !== row.tokenVersion) {
    return { ok: false, error: "invalid_grant", description: "The account is no longer active." };
  }

  const issueReplacement = () =>
    issueTokens({
      clientId: row.clientId,
      userId: row.userId,
      scope: row.scope,
      resource: row.resource,
      tokenVersion: user.tokenVersion,
    });

  // Already rotated (by us or by a concurrent caller). `refreshExpiresAt`
  // was set to the rotation time, so it doubles as "rotated at".
  if (row.rotatedToId || (row.refreshExpiresAt && row.refreshExpiresAt <= now)) {
    if (row.rotatedToId && isWithinGrace(row.refreshExpiresAt, now)) {
      return { ok: true, tokens: await issueReplacement() };
    }
    if (row.rotatedToId) {
      await prisma.oAuthToken.updateMany({
        where: { userId: row.userId, clientId: row.clientId, revokedAt: null },
        data: { revokedAt: now },
      });
      console.error("[mcp-oauth] refresh token reuse detected; grant revoked", {
        clientId,
        userId: row.userId,
      });
      return {
        ok: false,
        error: "invalid_grant",
        description: "This refresh token was already used. The grant has been revoked; sign in again.",
      };
    }
    // Rotation claimed but the replacement not linked yet: a concurrent
    // refresh is in flight right now. Same benign race as above.
    if (isWithinGrace(row.refreshExpiresAt, now)) {
      return { ok: true, tokens: await issueReplacement() };
    }
    return { ok: false, error: "invalid_grant", description: "Refresh token expired or revoked." };
  }

  // Claim this row before minting the replacement, so exactly one caller
  // performs the rotation. The loser of a simultaneous race falls into the
  // grace path above on its own terms instead of failing.
  const graceEnd = secondsFromNow(ROTATION_GRACE_SECONDS, now);
  const claimed = await prisma.oAuthToken.updateMany({
    where: {
      id: row.id,
      rotatedToId: null,
      revokedAt: null,
      OR: [{ refreshExpiresAt: null }, { refreshExpiresAt: { gt: now } }],
    },
    data: {
      refreshExpiresAt: now,
      accessExpiresAt: row.accessExpiresAt < graceEnd ? row.accessExpiresAt : graceEnd,
    },
  });
  if (claimed.count !== 1) {
    // Someone else claimed it between our read and our write.
    return { ok: true, tokens: await issueReplacement() };
  }

  const tokens = await issueReplacement();

  const replacement = await prisma.oAuthToken.findUnique({
    where: { accessTokenHash: hashCredential(tokens.accessToken) },
  });
  if (replacement) {
    await prisma.oAuthToken.update({ where: { id: row.id }, data: { rotatedToId: replacement.id } });
  }

  return { ok: true, tokens };
}

function isWithinGrace(rotatedAt: Date | null, now: Date): boolean {
  if (!rotatedAt) return false;
  return now.getTime() - rotatedAt.getTime() <= ROTATION_GRACE_SECONDS * 1000;
}

/// Resolves a bearer access token to the acting user.
///
/// Runs the SAME four checks as lib/mcp/auth.ts's personal-access-token
/// path, for the same reasons - the token's own validity, then the user's
/// deletedAt, status and tokenVersion. An OAuth grant is not a reason to
/// skip any of them.
export async function resolveOAuthAccessToken(rawToken: string): Promise<User | null> {
  if (!looksLikeOAuthAccessToken(rawToken)) return null;

  const row = await prisma.oAuthToken.findUnique({
    where: { accessTokenHash: hashCredential(rawToken) },
    include: { user: true },
  });
  if (!row) return null;

  const now = new Date();
  if (row.revokedAt) return null;
  if (row.accessExpiresAt <= now) return null;

  const user = row.user;
  if (!user || user.deletedAt) return null;
  if (user.status !== "ACTIVE") return null;
  if (user.tokenVersion !== row.tokenVersion) return null;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 15 * 60 * 1000) {
    await prisma.oAuthToken
      .update({ where: { id: row.id }, data: { lastUsedAt: now } })
      .catch((err: unknown) => console.error("[mcp-oauth] lastUsedAt failed", err));
  }

  return user;
}
