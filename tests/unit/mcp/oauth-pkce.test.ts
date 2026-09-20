import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_ACCESS_PREFIX,
  OAUTH_REFRESH_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  deriveS256Challenge,
  hashCredential,
  isSupportedChallengeMethod,
  looksLikeAuthorizationCode,
  looksLikeOAuthAccessToken,
  looksLikeRefreshToken,
  newAccessToken,
  newAuthorizationCode,
  newRefreshToken,
  secondsFromNow,
  verifyCodeChallenge,
} from "@/lib/mcp/oauth/pkce";

// Phase 15 (MCP OAuth, docs/adr/0005).
//
// PKCE is what stops an intercepted authorization code from being
// redeemed by whoever intercepted it. Every assertion below is a way that
// protection could be silently removed.

/// A verifier of the shape RFC 7636 section 4.1 requires.
function validVerifier(): string {
  return crypto.randomBytes(32).toString("base64url"); // 43 chars, unreserved set
}

describe("deriveS256Challenge()", () => {
  it("matches the RFC 7636 appendix B test vector", () => {
    // The worked example from the specification itself - the one value
    // that proves this is real S256 and not merely self-consistent.
    expect(deriveS256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("is unpadded base64url", () => {
    const c = deriveS256Challenge(validVerifier());
    expect(c).not.toContain("=");
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("verifyCodeChallenge()", () => {
  it("accepts the verifier that produced the challenge", () => {
    const v = validVerifier();
    expect(verifyCodeChallenge(v, deriveS256Challenge(v), "S256")).toBe(true);
  });

  it("rejects a different verifier", () => {
    const challenge = deriveS256Challenge(validVerifier());
    expect(verifyCodeChallenge(validVerifier(), challenge, "S256")).toBe(false);
  });

  it("refuses the plain method, so PKCE cannot be downgraded away", () => {
    // Accepting `plain` would let an attacker who intercepted the code
    // also satisfy the challenge, which is the whole threat PKCE exists
    // for. It must fail even when verifier and challenge are equal.
    const v = validVerifier();
    expect(verifyCodeChallenge(v, v, "plain")).toBe(false);
    expect(isSupportedChallengeMethod("plain")).toBe(false);
    expect(isSupportedChallengeMethod(undefined)).toBe(false);
    expect(isSupportedChallengeMethod("S256")).toBe(true);
  });

  it("rejects a verifier outside the RFC's length and character set", () => {
    const short = "a".repeat(42);
    const long = "a".repeat(129);
    expect(verifyCodeChallenge(short, deriveS256Challenge(short), "S256")).toBe(false);
    expect(verifyCodeChallenge(long, deriveS256Challenge(long), "S256")).toBe(false);
    const illegal = "a".repeat(42) + "/";
    expect(verifyCodeChallenge(illegal, deriveS256Challenge(illegal), "S256")).toBe(false);
  });

  it("rejects empty inputs rather than treating them as a match", () => {
    expect(verifyCodeChallenge("", "", "S256")).toBe(false);
    expect(verifyCodeChallenge(validVerifier(), "", "S256")).toBe(false);
  });

  it("does not throw when the challenge is a different length", () => {
    // Both sides are hashed to a fixed width before comparison precisely
    // so timingSafeEqual cannot throw - a throw would itself leak length.
    expect(() => verifyCodeChallenge(validVerifier(), "short", "S256")).not.toThrow();
  });
});

describe("credential formats", () => {
  it("gives each credential kind its own prefix", () => {
    expect(newAccessToken().startsWith(OAUTH_ACCESS_PREFIX)).toBe(true);
    expect(newRefreshToken().startsWith(OAUTH_REFRESH_PREFIX)).toBe(true);
  });

  it("never confuses one kind for another", () => {
    // The payoff: a refresh token sent as a bearer is rejected on sight,
    // without a database lookup.
    const access = newAccessToken();
    const refresh = newRefreshToken();
    const code = newAuthorizationCode();

    expect(looksLikeOAuthAccessToken(access)).toBe(true);
    expect(looksLikeOAuthAccessToken(refresh)).toBe(false);
    expect(looksLikeOAuthAccessToken(code)).toBe(false);
    expect(looksLikeRefreshToken(refresh)).toBe(true);
    expect(looksLikeRefreshToken(access)).toBe(false);
    expect(looksLikeAuthorizationCode(code)).toBe(true);
    expect(looksLikeAuthorizationCode(access)).toBe(false);
  });

  it("rejects a personal access token as an OAuth token", () => {
    // Phase 13's PATs use ank_mcp_. The two live side by side in
    // lib/mcp/auth.ts and must not be mistaken for each other.
    expect(looksLikeOAuthAccessToken("ank_mcp_" + "A".repeat(43))).toBe(false);
  });

  it("rejects malformed and empty values", () => {
    expect(looksLikeOAuthAccessToken(null)).toBe(false);
    expect(looksLikeOAuthAccessToken(OAUTH_ACCESS_PREFIX)).toBe(false);
    expect(looksLikeOAuthAccessToken(OAUTH_ACCESS_PREFIX + "tooshort")).toBe(false);
    expect(looksLikeOAuthAccessToken(OAUTH_ACCESS_PREFIX + "A".repeat(44))).toBe(false);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newAccessToken()));
    expect(seen.size).toBe(200);
  });
});

describe("hashCredential()", () => {
  it("is stable and never contains the input", () => {
    const t = newAccessToken();
    expect(hashCredential(t)).toBe(hashCredential(t));
    expect(hashCredential(t)).not.toContain(t.slice(OAUTH_ACCESS_PREFIX.length));
    expect(hashCredential(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("lifetimes", () => {
  it("keeps an authorization code well inside the RFC's ten-minute ceiling", () => {
    expect(AUTHORIZATION_CODE_TTL_SECONDS).toBeLessThanOrEqual(600);
  });

  it("expires an access token long before its refresh token", () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBeLessThan(REFRESH_TOKEN_TTL_SECONDS);
  });

  it("leaves room for Claude's proactive refresh five minutes before expiry", () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBeGreaterThan(5 * 60);
  });

  it("computes expiry from the instant given", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(secondsFromNow(3600, now).toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });
});
