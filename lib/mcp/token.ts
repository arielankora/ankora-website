import crypto from "crypto";

// Phase 13 (MCP server, docs/adr/0005): the token format itself.
//
// Deliberately free of `server-only`, Prisma and every other import: this
// module is pure so tests/unit/mcp/token.test.ts can exercise it directly
// without a database. Everything that touches a row lives in
// lib/mcp/auth.ts instead.

/// Prefix on every issued token. Two reasons it is not cosmetic:
/// 1. Secret scanners (GitHub push protection, gitleaks) match on stable
///    prefixes - a token pasted into a commit or a Slack message is far
///    more likely to be caught with one.
/// 2. lib/mcp/auth.ts can reject a malformed Authorization header without
///    a database round trip, so a scanner spraying random bearer values
///    never reaches Postgres.
export const MCP_TOKEN_PREFIX = "ank_mcp_";

/// 32 bytes of CSPRNG output, base64url-encoded (43 chars). Comfortably
/// past the 128-bit floor for a bearer credential, and URL/header-safe so
/// it survives being pasted into a Claude Desktop config file.
const SECRET_BYTES = 32;

/// Generates a new raw token. This value is shown to the user exactly
/// once, at issue time - only its hash is ever persisted.
export function generateMcpToken(): string {
  return MCP_TOKEN_PREFIX + crypto.randomBytes(SECRET_BYTES).toString("base64url");
}

/// The lookup key stored in McpAccessToken.tokenHash. SHA-256 (not bcrypt)
/// is the right choice here and differs from lib/app-auth/password.ts on
/// purpose: a password is low-entropy and human-chosen, so it needs a slow
/// KDF to survive offline cracking, whereas this token is 256 bits of
/// uniform randomness - brute force is not on the table, and the hash has
/// to be fast because it runs on every single MCP request.
export function hashMcpToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/// Cheap shape check used before any database work. Returns false for the
/// empty string, for a bare prefix, and for anything not carrying a
/// plausible base64url body of the right length.
export function looksLikeMcpToken(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!value.startsWith(MCP_TOKEN_PREFIX)) return false;
  const body = value.slice(MCP_TOKEN_PREFIX.length);
  // base64url of 32 bytes is always 43 chars with no padding.
  return /^[A-Za-z0-9_-]{43}$/.test(body);
}

/// Extracts the credential from an `Authorization` header. Tolerant of the
/// casing and spacing variations real clients send ("Bearer", "bearer",
/// extra whitespace) and returns null for anything else, including the
/// `Basic` scheme.
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

/// Default lifetime for a newly issued token. Chosen rather than "never
/// expires": a laptop that leaves the company stops working within a
/// quarter even if nobody remembers to revoke it. Callers may override.
export const DEFAULT_TOKEN_TTL_DAYS = 90;

export function defaultExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + DEFAULT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
