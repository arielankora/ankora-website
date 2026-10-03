import { generateProtectedResourceMetadata, getPublicOrigin } from "mcp-handler";
import { SUPPORTED_SCOPES } from "@/lib/mcp/oauth/store";

// RFC 9728 discovery for the client portal connector (/api/mcp/portal).
//
// Its own document rather than the staff one, because the `resource`
// value must be the exact URL the user typed into Claude: a client that
// connects to /api/mcp/portal and is told the resource is /api/mcp fails
// its audience check with no server-side error to find (the staff
// route's comment and tests/unit/mcp/discovery-routes.test.ts record
// that failure mode). Same authorization server, same scopes: the sign-in
// is the same, only what the signed-in person may see differs.
//
// Reached through the next.config.mjs rewrite of
// /.well-known/oauth-protected-resource/api/mcp/portal, which is listed
// before the catch-all that serves the staff document.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = getPublicOrigin(req);
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [origin],
    resourceUrl: `${origin}/api/mcp/portal`,
    additionalMetadata: {
      scopes_supported: [...SUPPORTED_SCOPES],
      resource_name: "Ankora Client Portal",
      resource_documentation: `${origin}/app/portal/file#claude`,
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
