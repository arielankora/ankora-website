import { getClient, normalizeScope } from "@/lib/mcp/oauth/store";
import { findMatchingRedirectUri } from "@/lib/mcp/oauth/redirect";
import { isSupportedChallengeMethod } from "@/lib/mcp/oauth/pkce";

// Phase 15 (MCP OAuth, docs/adr/0005): the authorization endpoint.
//
// It validates the request and then hands off to the consent screen at
// /app/oauth/consent, which is a normal authenticated page - so the
// EXISTING Auth.js login does the signing in. No second identity system,
// no password handling here, and "logout all sessions" keeps working
// because the consent page runs requireUser() like every other screen.
//
// The one rule that matters most in this file:
//
//   If the client_id or redirect_uri is bad, DO NOT redirect. Render an
//   error instead.
//
// RFC 6749 section 4.1.2.1 is explicit about this, and the reason is the
// whole open-redirect class: redirecting an error to an unvalidated URI is
// exactly the primitive an attacker wants. Only once the redirect URI is
// known-registered may errors be delivered by redirecting to it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorPage(title: string, detail: string, status = 400) {
  // Deliberately a plain, self-contained response rather than a redirect
  // or a rendered app page: at this point we have no trustworthy URI to
  // send the user to, and the person seeing it is a human in a browser.
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;color:#0f172a;line-height:1.6}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#475569;margin:0}</style>
</head><body><h1>${title}</h1><p>${detail}</p></body></html>`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams;

  const clientId = p.get("client_id") ?? "";
  const redirectUri = p.get("redirect_uri") ?? "";
  const responseType = p.get("response_type") ?? "";
  const codeChallenge = p.get("code_challenge") ?? "";
  const codeChallengeMethod = p.get("code_challenge_method") ?? "";
  const state = p.get("state") ?? "";
  const resource = p.get("resource");

  // --- checks that must NOT redirect -------------------------------------

  const client = await getClient(clientId);
  if (!client) {
    return errorPage(
      "Unknown application",
      "This authorization request names an application Ankora does not recognise. Nothing was shared. Try connecting again from Claude."
    );
  }

  const matched = redirectUri ? findMatchingRedirectUri(redirectUri, client.redirectUris) : null;
  if (!matched) {
    return errorPage(
      "Invalid redirect address",
      "The address this application asked to be returned to is not one it registered. Nothing was shared."
    );
  }

  // --- from here, errors may be delivered to the validated URI ------------

  const fail = (error: string, description: string) => {
    const target = new URL(redirectUri);
    target.searchParams.set("error", error);
    target.searchParams.set("error_description", description);
    if (state) target.searchParams.set("state", state);
    return Response.redirect(target.toString(), 302);
  };

  if (responseType !== "code") {
    return fail("unsupported_response_type", "Only the authorization code flow is supported.");
  }
  if (!codeChallenge) {
    // PKCE is mandatory, not negotiable: OAuth 2.1 removes the implicit
    // flow and requires PKCE for every authorization code request.
    return fail("invalid_request", "code_challenge is required (PKCE).");
  }
  if (!isSupportedChallengeMethod(codeChallengeMethod)) {
    return fail("invalid_request", "code_challenge_method must be S256.");
  }

  // Hand off to the consent screen. Everything needed to mint the code
  // travels in the query string, and NOTHING is written to the database
  // yet - a request that a human never approves leaves no trace.
  const consent = new URL("/app/oauth/consent", url.origin);
  consent.searchParams.set("client_id", clientId);
  consent.searchParams.set("redirect_uri", redirectUri);
  consent.searchParams.set("code_challenge", codeChallenge);
  consent.searchParams.set("code_challenge_method", codeChallengeMethod);
  consent.searchParams.set("scope", normalizeScope(p.get("scope")));
  if (state) consent.searchParams.set("state", state);
  if (resource) consent.searchParams.set("resource", resource);

  return Response.redirect(consent.toString(), 302);
}
