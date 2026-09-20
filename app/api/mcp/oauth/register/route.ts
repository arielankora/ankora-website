import { registerClient } from "@/lib/mcp/oauth/store";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";

// Phase 15 (MCP OAuth, docs/adr/0005): Dynamic Client Registration
// (RFC 7591).
//
// Claude registers a fresh client on every new connection, so this
// endpoint is unauthenticated by design - that is what DCR is. The
// exposure is bounded rather than removed: a registration creates a row
// with no privileges at all. Holding a client_id lets you START an
// authorization flow; it does not let you finish one, because finishing
// requires a human to sign in to Ankora and approve.
//
// The real protection is therefore the rate limit below plus that consent
// step, not secrecy of this endpoint.
//
// RFC 7591 section 3.1: the request body is application/json - note this
// differs from the token endpoint, which is form-urlencoded. Anthropic's
// own integration guide calls that difference out as a common source of
// 415s, so the two are parsed separately on purpose.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// Registrations per IP per hour. Generous for legitimate use (Claude
/// registers once per connection) and low enough that nobody fills the
/// table from one host.
const REGISTRATIONS_PER_HOUR = 30;

function badRequest(error: string, description: string, status = 400) {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const limit = await checkRateLimit(
    `mcp-oauth-register:${clientIpFrom(req.headers)}`,
    REGISTRATIONS_PER_HOUR,
    60 * 60 * 1000
  );
  if (!limit.allowed) {
    return Response.json(
      { error: "temporarily_unavailable", error_description: "Too many registrations." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid_client_metadata", "Body must be JSON (RFC 7591 section 3.1).");
  }

  const input = body as {
    client_name?: unknown;
    redirect_uris?: unknown;
    grant_types?: unknown;
    scope?: unknown;
  };

  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
    return badRequest("invalid_redirect_uri", "redirect_uris is required and must be a non-empty array.");
  }
  if (input.redirect_uris.length > 10 || !input.redirect_uris.every((u) => typeof u === "string")) {
    return badRequest("invalid_redirect_uri", "redirect_uris must be at most 10 strings.");
  }

  const result = await registerClient({
    clientName: typeof input.client_name === "string" ? input.client_name : undefined,
    redirectUris: input.redirect_uris as string[],
    grantTypes: Array.isArray(input.grant_types)
      ? (input.grant_types.filter((g) => typeof g === "string") as string[])
      : undefined,
    scopes: typeof input.scope === "string" ? input.scope : undefined,
  });

  if ("error" in result) {
    return badRequest(result.error, result.description);
  }

  // RFC 7591 section 3.2.1: 201 with the registered metadata. No
  // client_secret is returned because this is a public client - PKCE is
  // what authenticates it at the token endpoint.
  return Response.json(
    {
      client_id: result.clientId,
      client_name: result.clientName,
      redirect_uris: result.redirectUris,
      grant_types: result.grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: result.scopes.join(" "),
      // 0 means "does not expire", per RFC 7591.
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
