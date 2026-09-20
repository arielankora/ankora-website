import { describe, expect, it } from "vitest";
import {
  CLAUDE_HOSTED_REDIRECT,
  findMatchingRedirectUri,
  isRegisterableRedirectUri,
  redirectUriMatches,
} from "@/lib/mcp/oauth/redirect";
import { safeCallbackUrl } from "@/lib/app-auth/callback-url";

// Phase 15 (MCP OAuth, docs/adr/0005).
//
// Loose redirect matching is the classic OAuth break: it turns the
// authorization endpoint into an open redirect that hands authorization
// codes to whoever asked for them. The rule is exact equality with one
// narrow exception (RFC 8252 loopback ports), and every test below is a
// way that exception could be widened by accident.

describe("exact matching", () => {
  it("accepts an identical URI", () => {
    expect(redirectUriMatches(CLAUDE_HOSTED_REDIRECT, CLAUDE_HOSTED_REDIRECT)).toBe(true);
  });

  it("rejects a different path on the same host", () => {
    expect(redirectUriMatches("https://claude.ai/evil", CLAUDE_HOSTED_REDIRECT)).toBe(false);
  });

  it("rejects a different host", () => {
    expect(
      redirectUriMatches("https://claude.ai.evil.com/api/mcp/auth_callback", CLAUDE_HOSTED_REDIRECT)
    ).toBe(false);
  });

  it("rejects a subdomain of the registered host", () => {
    expect(
      redirectUriMatches("https://evil.claude.ai/api/mcp/auth_callback", CLAUDE_HOSTED_REDIRECT)
    ).toBe(false);
  });

  it("rejects an added query string", () => {
    expect(
      redirectUriMatches(CLAUDE_HOSTED_REDIRECT + "?next=https://evil.com", CLAUDE_HOSTED_REDIRECT)
    ).toBe(false);
  });

  it("rejects a different port on an https URI", () => {
    // The port exception is loopback-only. An https URI on another port is
    // a different origin and must not match.
    expect(redirectUriMatches("https://claude.ai:8443/api/mcp/auth_callback", CLAUDE_HOSTED_REDIRECT)).toBe(
      false
    );
  });

  it("rejects a downgrade to http", () => {
    expect(
      redirectUriMatches("http://claude.ai/api/mcp/auth_callback", CLAUDE_HOSTED_REDIRECT)
    ).toBe(false);
  });
});

describe("the RFC 8252 loopback exception", () => {
  it("ignores the port on 127.0.0.1, which is what makes Claude Code work", () => {
    expect(redirectUriMatches("http://127.0.0.1:3118/callback", "http://127.0.0.1/callback")).toBe(true);
    expect(redirectUriMatches("http://127.0.0.1:51234/callback", "http://127.0.0.1/callback")).toBe(true);
  });

  it("ignores the port on localhost too, because Claude Code declares both", () => {
    expect(redirectUriMatches("http://localhost:3118/callback", "http://localhost/callback")).toBe(true);
  });

  it("does not let 127.0.0.1 stand in for localhost, or the reverse", () => {
    // Distinct origins to a browser, and they can resolve differently.
    expect(redirectUriMatches("http://localhost:3118/callback", "http://127.0.0.1/callback")).toBe(false);
    expect(redirectUriMatches("http://127.0.0.1:3118/callback", "http://localhost/callback")).toBe(false);
  });

  it("still requires the path to match exactly", () => {
    expect(redirectUriMatches("http://127.0.0.1:3118/evil", "http://127.0.0.1/callback")).toBe(false);
  });

  it("does not extend to any other host", () => {
    // The whole point: a non-loopback host gets no port forgiveness.
    expect(redirectUriMatches("http://evil.com:3118/callback", "http://evil.com/callback")).toBe(false);
    expect(redirectUriMatches("http://169.254.169.254:80/callback", "http://169.254.169.254/callback")).toBe(
      false
    );
  });

  it("is not fooled by a hostname that merely contains a loopback name", () => {
    expect(
      redirectUriMatches("http://localhost.evil.com:3118/callback", "http://localhost/callback")
    ).toBe(false);
    expect(redirectUriMatches("http://127.0.0.1.evil.com/callback", "http://127.0.0.1/callback")).toBe(
      false
    );
  });

  it("rejects embedded credentials", () => {
    expect(redirectUriMatches("http://user:pw@127.0.0.1:3118/callback", "http://127.0.0.1/callback")).toBe(
      false
    );
  });
});

describe("findMatchingRedirectUri()", () => {
  const registered = ["http://localhost/callback", "http://127.0.0.1/callback"];

  it("finds the right entry among several", () => {
    expect(findMatchingRedirectUri("http://127.0.0.1:9999/callback", registered)).toBe(
      "http://127.0.0.1/callback"
    );
  });

  it("returns null when nothing matches", () => {
    expect(findMatchingRedirectUri("https://evil.com/callback", registered)).toBeNull();
  });

  it("returns null for an empty registration list", () => {
    expect(findMatchingRedirectUri(CLAUDE_HOSTED_REDIRECT, [])).toBeNull();
  });
});

describe("isRegisterableRedirectUri()", () => {
  it("accepts https and loopback http", () => {
    expect(isRegisterableRedirectUri(CLAUDE_HOSTED_REDIRECT)).toBe(true);
    expect(isRegisterableRedirectUri("http://127.0.0.1/callback")).toBe(true);
    expect(isRegisterableRedirectUri("http://localhost/callback")).toBe(true);
  });

  it("refuses plaintext http anywhere but loopback", () => {
    expect(isRegisterableRedirectUri("http://evil.com/callback")).toBe(false);
  });

  it("refuses a fragment, which RFC 6749 forbids on a redirect URI", () => {
    expect(isRegisterableRedirectUri("https://claude.ai/cb#frag")).toBe(false);
  });

  it("refuses every scheme but https and loopback http", () => {
    // A first cut accepted any `scheme://host`, and this test caught that
    // it therefore accepted data:// too. The shape of a scheme is a bad
    // proxy for whether it is safe to receive an authorization code, so
    // the allowlist is now the two schemes Claude's clients actually use.
    expect(isRegisterableRedirectUri("javascript://claude.ai/%0aalert(1)")).toBe(false);
    expect(isRegisterableRedirectUri("data://text/html,x")).toBe(false);
    expect(isRegisterableRedirectUri("file:///etc/passwd")).toBe(false);
    expect(isRegisterableRedirectUri("blob://x/y")).toBe(false);
    // Even a benign-looking custom scheme: allowed only by an explicit
    // future decision, never by default.
    expect(isRegisterableRedirectUri("myapp://callback")).toBe(false);
  });

  it("refuses embedded credentials and unparseable values", () => {
    expect(isRegisterableRedirectUri("https://user:pw@claude.ai/cb")).toBe(false);
    expect(isRegisterableRedirectUri("not a uri")).toBe(false);
    expect(isRegisterableRedirectUri("")).toBe(false);
  });
});

// ---------------------------------------------------- Phase 15: login return

describe("safeCallbackUrl()", () => {
  it("keeps a legitimate in-product destination", () => {
    expect(safeCallbackUrl("/app/oauth/consent?client_id=x")).toBe("/app/oauth/consent?client_id=x");
  });

  it("falls back to /app for anything empty or absent", () => {
    expect(safeCallbackUrl(null)).toBe("/app");
    expect(safeCallbackUrl("")).toBe("/app");
  });

  it("refuses an absolute URL to another origin", () => {
    // The classic phishing aid: sign in to the real site, get bounced to a
    // copy of it.
    expect(safeCallbackUrl("https://evil.com/login")).toBe("/app");
    expect(safeCallbackUrl("http://evil.com")).toBe("/app");
  });

  it("refuses protocol-relative forms, which browsers read as another host", () => {
    expect(safeCallbackUrl("//evil.com")).toBe("/app");
    expect(safeCallbackUrl("/\\evil.com")).toBe("/app");
  });

  it("refuses paths outside the product", () => {
    expect(safeCallbackUrl("/he/blog")).toBe("/app");
    expect(safeCallbackUrl("/api/mcp")).toBe("/app");
    // "/appfoo" starts with "/app" but is not inside it - the check is on
    // "/app/" with the slash for exactly this reason.
    expect(safeCallbackUrl("/appfoo/evil")).toBe("/app");
  });

  it("refuses control characters used to smuggle a header or a newline", () => {
    expect(safeCallbackUrl("/app/x\nLocation: https://evil.com")).toBe("/app");
    expect(safeCallbackUrl("/app/x\r\n")).toBe("/app");
  });

  it("refuses a non-string value", () => {
    expect(safeCallbackUrl(new File([], "x") as unknown as FormDataEntryValue)).toBe("/app");
  });
});

describe("safeCallbackUrl() — the absolute form Auth.js actually sends", () => {
  const SELF = "https://ankora-website.vercel.app";

  it("accepts an absolute URL on this app's own origin", () => {
    // Auth.js middleware writes callbackUrl as a full URL. Refusing it
    // would send every real sign-in to the dashboard instead of back to
    // the consent screen - found by following the chain on a deployment.
    expect(safeCallbackUrl(`${SELF}/app/oauth/consent?client_id=x`, SELF)).toBe(
      "/app/oauth/consent?client_id=x"
    );
  });

  it("refuses an absolute URL on any other origin", () => {
    expect(safeCallbackUrl("https://evil.com/app/oauth/consent", SELF)).toBe("/app");
  });

  it("refuses a lookalike host that merely starts with ours", () => {
    // The reason the origin is compared parsed, not as a string prefix.
    expect(safeCallbackUrl("https://ankora-website.vercel.app.evil.com/app/x", SELF)).toBe("/app");
  });

  it("refuses an absolute URL on our origin but outside the product", () => {
    expect(safeCallbackUrl(`${SELF}/he/blog`, SELF)).toBe("/app");
  });

  it("refuses a scheme change on our own host", () => {
    expect(safeCallbackUrl("http://ankora-website.vercel.app/app/x", SELF)).toBe("/app");
  });

  it("still accepts the relative form when an origin is supplied", () => {
    expect(safeCallbackUrl("/app/oauth/consent?a=1", SELF)).toBe("/app/oauth/consent?a=1");
  });

  it("refuses an absolute URL when no origin is known", () => {
    expect(safeCallbackUrl(`${SELF}/app/oauth/consent`)).toBe("/app");
  });
});
