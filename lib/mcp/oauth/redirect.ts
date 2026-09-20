// Phase 15 (MCP OAuth, docs/adr/0005): redirect URI matching.
//
// This is the single most security-sensitive comparison in the whole
// authorization server. A redirect URI that matches too loosely is an
// open redirect that hands authorization codes to whoever asked - the
// classic OAuth break. So the rule here is exact string equality, with
// exactly one narrow exception, spelled out below.
//
// Pure by design, so tests/unit/mcp/oauth-redirect.test.ts can cover the
// exception's edges directly.

/// Claude's hosted surfaces (claude.ai web, Desktop, mobile, Cowork) all
/// use this one callback.
export const CLAUDE_HOSTED_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

/// The exception: Claude Code is a native client and uses an RFC 8252
/// loopback redirect on an EPHEMERAL port, chosen per session. It declares
/// `http://localhost/callback` and `http://127.0.0.1/callback` in its
/// Client ID Metadata Document, and the authorization server is required
/// to accept those with the port ignored - otherwise a native client can
/// never complete a flow, because it cannot know its port at registration
/// time.
///
/// RFC 8252 section 7.3 mandates the port-agnostic match for the IP
/// literal form. Section 8.3 discourages the `localhost` name, but Claude
/// Code declares both, so both are accepted here.
///
/// The exception is deliberately narrow. It applies ONLY when:
///   - the scheme is http (loopback is the one place plaintext is allowed)
///   - the host is exactly "localhost", "127.0.0.1" or "[::1]"
///   - the path, query and fragment match the registered URI exactly
/// Everything else - including any other host, any https URI, and any
/// path difference - falls through to exact string equality.
function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/// Whether `presented` is an acceptable match for `registered`.
export function redirectUriMatches(presented: string, registered: string): boolean {
  if (presented === registered) return true;

  const a = parse(presented);
  const b = parse(registered);
  if (!a || !b) return false;

  // Both sides must be loopback http for the port exception to apply.
  if (a.protocol !== "http:" || b.protocol !== "http:") return false;
  if (!isLoopbackHost(a.hostname === "::1" ? "[::1]" : a.hostname)) return false;
  if (!isLoopbackHost(b.hostname === "::1" ? "[::1]" : b.hostname)) return false;

  // The hostnames must still agree with each other: a client that
  // registered 127.0.0.1 does not thereby get localhost, which can resolve
  // differently and is a distinct origin to the browser.
  if (a.hostname !== b.hostname) return false;

  // Everything except the port must match exactly. Username/password are
  // compared too - a URI carrying credentials is not the same URI.
  return (
    a.pathname === b.pathname &&
    a.search === b.search &&
    a.hash === b.hash &&
    a.username === b.username &&
    a.password === b.password
  );
}

/// Picks the registered URI that `presented` matches, or null.
export function findMatchingRedirectUri(
  presented: string,
  registered: readonly string[]
): string | null {
  for (const candidate of registered) {
    if (redirectUriMatches(presented, candidate)) return candidate;
  }
  return null;
}

/// Whether a URI is acceptable to register in the first place.
///
/// Registration is where the real filtering happens: anything accepted
/// here can later receive an authorization code. https is required except
/// on loopback, and a fragment is forbidden outright because RFC 6749
/// section 3.1.2 says redirect URIs must not include one - the
/// authorization response appends its own.
export function isRegisterableRedirectUri(uri: string): boolean {
  const u = parse(uri);
  if (!u) return false;
  if (u.hash) return false;
  if (u.username || u.password) return false;

  if (u.protocol === "https:") return u.hostname.length > 0;
  if (u.protocol === "http:") {
    return isLoopbackHost(u.hostname === "::1" ? "[::1]" : u.hostname);
  }

  // Everything else is refused, custom schemes included.
  //
  // A first cut allowed any `scheme://host` on the theory that some native
  // client might register one. A unit test immediately showed that
  // accepting arbitrary schemes also accepts `data://text/html,x`, and the
  // same reasoning covers javascript:, file: and blob: - the shape of a
  // scheme is a bad proxy for whether it is safe to hand an authorization
  // code to. Allowlisting the two schemes Claude's clients actually use
  // (https everywhere, loopback http for Claude Code) removes the whole
  // class of question. A future native client needing a custom scheme is a
  // deliberate one-line addition, not something to leave open by default.
  return false;
}
