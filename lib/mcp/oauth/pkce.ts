import crypto from "crypto";

// Phase 15 (MCP OAuth, docs/adr/0005): PKCE, and the credential formats
// the authorization server issues.
//
// Pure by design - no `server-only`, no Prisma - so
// tests/unit/mcp/oauth-pkce.test.ts can exercise the crypto directly.
// Everything that touches a row lives in lib/mcp/oauth/store.ts.

/// Claude always sends `code_challenge_method=S256`, and the MCP
/// authorization spec requires servers to support it. `plain` is
/// deliberately NOT accepted: it offers no protection against an
/// intercepted authorization code, which is the entire threat PKCE
/// exists for, and accepting it would let a downgrade attack strip the
/// protection by simply asking for it.
export const SUPPORTED_CODE_CHALLENGE_METHODS = ["S256"] as const;

export function isSupportedChallengeMethod(method: string | null | undefined): boolean {
  return method === "S256";
}

/// RFC 7636 section 4.2: BASE64URL(SHA256(ASCII(verifier))), unpadded.
export function deriveS256Challenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/// Verifies a code verifier against the challenge stored at authorization
/// time.
///
/// The comparison is constant-time. Unlike lib/mcp/auth.ts's token lookup
/// - where the presented value is hashed into an indexed key and a wrong
/// value simply finds no row - here both sides are already in hand and are
/// compared directly, so `===` would leak how many leading characters
/// matched. Both sides are hashed to a fixed width first because
/// timingSafeEqual throws on unequal lengths, and that throw would itself
/// be a length oracle. Same reasoning as lib/cron-auth.ts.
export function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: string
): boolean {
  if (!isSupportedChallengeMethod(method)) return false;
  if (!verifier || !challenge) return false;
  // RFC 7636 section 4.1: the verifier is 43-128 characters from an
  // unreserved set. Rejecting anything outside that stops a degenerate
  // verifier from being offered at all.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;

  const derived = deriveS256Challenge(verifier);
  const a = crypto.createHash("sha256").update(derived, "utf8").digest();
  const b = crypto.createHash("sha256").update(challenge, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- formats

/// Distinct prefixes per credential kind. Three reasons they are not
/// cosmetic: secret scanners match on stable prefixes, lib/mcp/auth.ts can
/// tell an OAuth access token from a personal access token without a
/// database round trip, and a refresh token accidentally sent as a bearer
/// is rejected on sight rather than looked up.
export const OAUTH_ACCESS_PREFIX = "ank_oat_";
export const OAUTH_REFRESH_PREFIX = "ank_ort_";
export const OAUTH_CODE_PREFIX = "ank_cod_";
export const OAUTH_CLIENT_PREFIX = "ank_cli_";

const SECRET_BYTES = 32;

function mint(prefix: string): string {
  return prefix + crypto.randomBytes(SECRET_BYTES).toString("base64url");
}

export const newAccessToken = () => mint(OAUTH_ACCESS_PREFIX);
export const newRefreshToken = () => mint(OAUTH_REFRESH_PREFIX);
export const newAuthorizationCode = () => mint(OAUTH_CODE_PREFIX);
export const newClientId = () => mint(OAUTH_CLIENT_PREFIX);

/// The stored lookup key. SHA-256 rather than a slow KDF for the same
/// reason lib/mcp/token.ts gives: these are 256 bits of CSPRNG output, so
/// offline cracking is not the threat, and the hash runs on every request.
export function hashCredential(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function looksLikeOAuthAccessToken(value: string | null | undefined): boolean {
  return hasShape(value, OAUTH_ACCESS_PREFIX);
}

export function looksLikeRefreshToken(value: string | null | undefined): boolean {
  return hasShape(value, OAUTH_REFRESH_PREFIX);
}

export function looksLikeAuthorizationCode(value: string | null | undefined): boolean {
  return hasShape(value, OAUTH_CODE_PREFIX);
}

function hasShape(value: string | null | undefined, prefix: string): boolean {
  if (!value || !value.startsWith(prefix)) return false;
  // base64url of 32 bytes is always 43 characters, unpadded.
  return /^[A-Za-z0-9_-]{43}$/.test(value.slice(prefix.length));
}

// ----------------------------------------------------------------- policy

/// Access tokens are short-lived because revocation is checked at use
/// time anyway (User.tokenVersion, status, deletedAt) - an hour bounds the
/// window in which a leaked token is useful without making refresh churn
/// constant. Claude proactively refreshes up to five minutes before
/// expiry, so an hour means roughly one refresh per active hour.
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/// Refresh tokens last a month and rotate on every use.
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/// Authorization codes are single-use and short-lived; RFC 6749 section
/// 4.1.2 recommends a maximum of ten minutes.
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;

export function secondsFromNow(seconds: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + seconds * 1000);
}
