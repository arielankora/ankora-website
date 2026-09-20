import { generateProtectedResourceMetadata, getPublicOrigin } from "mcp-handler";
import { SUPPORTED_SCOPES } from "@/lib/mcp/oauth/store";

// Phase 15 (MCP OAuth, docs/adr/0005): RFC 9728 protected resource
// metadata.
//
// This is the document the `WWW-Authenticate: Bearer resource_metadata=...`
// header on every 401 from /api/mcp already points at - that header has
// been going out since Phase 1, emitted by mcp-handler's withMcpAuth, and
// was verified in production. Until now the URL it named returned 404,
// which was harmless because nothing followed it. This route is what makes
// the pointer resolve, and it is the entry point to the whole flow.
//
// `resource` must match the MCP server URL exactly as the user types it
// into Claude, including the path - hence /api/mcp rather than the origin.
//
// Mapped onto /.well-known/oauth-protected-resource by a rewrite in
// next.config.mjs; see the authorization-server route for why a rewrite
// rather than a dot-directory.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = getPublicOrigin(req);
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [origin],
    resourceUrl: `${origin}/api/mcp`,
    additionalMetadata: {
      scopes_supported: [...SUPPORTED_SCOPES],
      resource_name: "Ankora Time Tracking",
      // Points at the in-app guide, not back at the MCP endpoint itself.
      // A documentation URL that resolves to the thing it is meant to
      // document is a self-reference, not documentation - anyone (or any
      // client) that followed it got JSON-RPC, not an explanation. The
      // guide anchor is the same page the Integrations and Profile cards
      // link to, so there is exactly one set of setup instructions.
      resource_documentation: `${origin}/app/guide#mcp-claude`,
    },
  });

  return Response.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=300",
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
