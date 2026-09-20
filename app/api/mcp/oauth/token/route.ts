import { prisma } from "@/lib/prisma";
import { verifyCodeChallenge } from "@/lib/mcp/oauth/pkce";
import { consumeAuthorizationCode, getClient, issueTokens, rotateRefreshToken } from "@/lib/mcp/oauth/store";
import { redirectUriMatches } from "@/lib/mcp/oauth/redirect";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";

// Phase 15 (MCP OAuth, docs/adr/0005): the token endpoint.
//
// Two grants: authorization_code and refresh_token.
//
// The body is application/x-www-form-urlencoded, per RFC 6749 section
// 4.1.3 - NOT JSON, unlike the registration endpoint. Anthropic's
// integration guide names a JSON-only body parser here as a common cause
// of intermittent 415s, so the two endpoints parse differently on purpose.
//
// Claude allows 10 seconds for an initial exchange and 30 for a refresh.
// Everything here is two or three indexed queries.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

function oauthError(error: string, description: string, status = 400) {
  // RFC 6749 section 5.2 error codes, used exactly. Anthropic's guide
  // calls out that a refresh failure must be `invalid_grant` and not a
  // custom code, because Claude keys its re-authentication behaviour on
  // that value - a wrong code here turns "sign in again" into a silent
  // dead connection.
  return Response.json({ error, error_description: description }, { status, headers: NO_STORE });
}

export async function POST(req: Request) {
  const limit = await checkRateLimit(`mcp-oauth-token:${clientIpFrom(req.headers)}`, 120, 60 * 1000);
  if (!limit.allowed) {
    return Response.json(
      { error: "temporarily_unavailable", error_description: "Too many token requests." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError(
      "invalid_request",
      "The token endpoint expects application/x-www-form-urlencoded (RFC 6749 section 4.1.3)."
    );
  }

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return oauthError("invalid_request", "Malformed request body.");
  }

  const grantType = form.get("grant_type") ?? "";
  const clientId = form.get("client_id") ?? "";

  const client = await getClient(clientId);
  if (!client) return oauthError("invalid_client", "Unknown client_id.", 401);

  if (grantType === "authorization_code") {
    return handleAuthorizationCode(form, clientId);
  }
  if (grantType === "refresh_token") {
    return handleRefresh(form, clientId);
  }
  return oauthError("unsupported_grant_type", "Supported grants: authorization_code, refresh_token.");
}

async function handleAuthorizationCode(form: URLSearchParams, clientId: string) {
  const code = form.get("code") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const verifier = form.get("code_verifier") ?? "";

  if (!code || !verifier) {
    return oauthError("invalid_request", "code and code_verifier are required.");
  }

  // Consumed FIRST, atomically. Validation happens afterwards on the
  // claimed row, so a code cannot be probed repeatedly by sending it with
  // wrong verifiers - the first attempt burns it either way. That is the
  // conservative ordering: a legitimate client sends the right verifier
  // the first time.
  const claimed = await consumeAuthorizationCode(code);
  if (!claimed) {
    return oauthError("invalid_grant", "The authorization code is invalid, expired, or already used.");
  }

  if (claimed.clientId !== clientId) {
    return oauthError("invalid_grant", "This code was issued to a different client.");
  }
  if (!redirectUriMatches(redirectUri, claimed.redirectUri)) {
    return oauthError("invalid_grant", "redirect_uri does not match the one used to obtain the code.");
  }
  if (!verifyCodeChallenge(verifier, claimed.codeChallenge, claimed.codeChallengeMethod)) {
    return oauthError("invalid_grant", "PKCE verification failed.");
  }

  // Re-check the user at exchange time rather than trusting the snapshot
  // taken at consent: an account can be suspended in the seconds between
  // approving and exchanging, and this is the last moment before a token
  // exists.
  const user = await prisma.user.findUnique({ where: { id: claimed.userId } });
  if (!user || user.deletedAt || user.status !== "ACTIVE") {
    return oauthError("invalid_grant", "The account is no longer active.");
  }

  const tokens = await issueTokens({
    clientId,
    userId: user.id,
    scope: claimed.scope,
    resource: claimed.resource,
    tokenVersion: user.tokenVersion,
  });

  return Response.json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scope,
    },
    { headers: NO_STORE }
  );
}

async function handleRefresh(form: URLSearchParams, clientId: string) {
  const refreshToken = form.get("refresh_token") ?? "";
  if (!refreshToken) return oauthError("invalid_request", "refresh_token is required.");

  const result = await rotateRefreshToken(refreshToken, clientId);
  if (!result.ok) {
    return oauthError(result.error, result.description);
  }

  // The rotated refresh token is returned in the SAME response that
  // invalidated the old one, as the MCP authorization spec requires for
  // public clients.
  return Response.json(
    {
      access_token: result.tokens.accessToken,
      token_type: "Bearer",
      expires_in: result.tokens.expiresIn,
      refresh_token: result.tokens.refreshToken,
      scope: result.tokens.scope,
    },
    { headers: NO_STORE }
  );
}
