import { getPublicOrigin } from "mcp-handler";
import { SUPPORTED_SCOPES } from "@/lib/mcp/oauth/store";
import { SUPPORTED_CODE_CHALLENGE_METHODS } from "@/lib/mcp/oauth/pkce";

// Phase 15 (MCP OAuth, docs/adr/0005): RFC 8414 authorization server
// metadata.
//
// Served from a normal route and mapped onto
// /.well-known/oauth-authorization-server by a rewrite in next.config.mjs.
// The rewrite exists because Next.js does not clearly document whether a
// dot-prefixed directory under app/ is routable, and a wrong guess here
// fails only at deploy time with a 404 that looks like a discovery bug.
// A rewrite is unambiguous.
//
// Claude allows 10 seconds for this request. It reads nothing and touches
// no database, so it answers in single-digit milliseconds.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function metadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    // Advertising this is what makes Dynamic Client Registration available.
    // Without it Claude falls back to looking for Anthropic-held or
    // user-supplied credentials, neither of which exists for this server.
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // "none" is required, not an oversight: DCR registers Claude as a
    // public client, which authenticates at the token endpoint with PKCE
    // and no secret. The MCP spec also requires this value to be present
    // for a CIMD client to authenticate.
    token_endpoint_auth_methods_supported: ["none"],
    // The MCP authorization spec requires servers to advertise this so a
    // spec-compliant client can verify PKCE support before starting.
    code_challenge_methods_supported: [...SUPPORTED_CODE_CHALLENGE_METHODS],
    service_documentation: `${origin}/api/mcp`,
  };
}

export async function GET(req: Request) {
  return Response.json(metadata(getPublicOrigin(req)), {
    headers: {
      // Discovery is hit on every fresh connection; a short cache keeps it
      // off the critical path without making a change take long to land.
      "Cache-Control": "public, max-age=300",
      // Browser-based MCP clients read this cross-origin.
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-protocol-version",
      "Access-Control-Max-Age": "86400",
    },
  });
}
