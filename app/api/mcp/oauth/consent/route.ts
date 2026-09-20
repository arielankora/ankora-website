import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { createAuthorizationCode, getClient, normalizeScope } from "@/lib/mcp/oauth/store";
import { findMatchingRedirectUri } from "@/lib/mcp/oauth/redirect";
import { isSupportedChallengeMethod } from "@/lib/mcp/oauth/pkce";
import { recordAudit } from "@/lib/app-auth/audit";

// Phase 15 (MCP OAuth, docs/adr/0005): what the consent screen's form
// posts to.
//
// A route handler rather than a Server Action, for one reason: the
// response is a 302 to an address outside this origin, and a plain
// handler makes that explicit and easy to reason about. It also keeps the
// screen itself a pure render with no client JavaScript.
//
// Everything the form submits is re-validated here. The form is hidden
// fields in a browser, which is to say it is user input.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// Sends the browser onward to the client's redirect URI.
///
/// NOT `Response.redirect`, deliberately. This response is the result of a
/// form POST, and the `form-action 'self'` directive in next.config.mjs's
/// CSP is enforced against the target of a post-submission REDIRECT by
/// some browsers and not others - the specification and the engines have
/// disagreed for years. Depending on that inconsistency would mean a
/// connection that works in one browser and dies at the last step in
/// another, with a console error no user will ever read.
///
/// A document response that navigates itself sidesteps the question:
/// `form-action` governs where a form may submit, not where a page may
/// navigate. The visible link is the fallback for anyone whose browser or
/// extension blocks meta-refresh, so the flow is never a dead end.
function handOff(target: URL): Response {
  const href = target.toString();
  const escaped = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${escaped}">
<meta name="robots" content="noindex">
<title>Returning to Claude</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:30rem;margin:20vh auto;padding:0 1.5rem;color:#0f172a;text-align:center;line-height:1.6}a{color:#0f172a}</style>
</head><body><p>Returning to Claude&hellip;</p><p><a href="${escaped}">Continue</a></p></body></html>`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response("Your session expired. Start the connection again from Claude.", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    throw err;
  }

  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");
  const codeChallengeMethod = String(form.get("code_challenge_method") ?? "");
  const state = String(form.get("state") ?? "");
  const resource = String(form.get("resource") ?? "") || null;
  const decision = String(form.get("decision") ?? "");

  const client = clientId ? await getClient(clientId) : null;
  if (!client || !findMatchingRedirectUri(redirectUri, client.redirectUris)) {
    // Same rule as the authorize endpoint: with no validated redirect
    // URI there is nowhere safe to send anyone, so nothing is redirected.
    return new Response("This connection request is no longer valid.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const target = new URL(redirectUri);
  if (state) target.searchParams.set("state", state);

  if (decision !== "approve") {
    // RFC 6749 section 4.1.2.1: a refusal is reported to the client as
    // access_denied rather than silently dropped, so Claude can say "you
    // declined" instead of hanging.
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_description", "The user declined the connection.");
    return handOff(target);
  }

  if (!codeChallenge || !isSupportedChallengeMethod(codeChallengeMethod)) {
    target.searchParams.set("error", "invalid_request");
    target.searchParams.set("error_description", "A valid S256 code_challenge is required.");
    return handOff(target);
  }

  const scope = normalizeScope(String(form.get("scope") ?? ""));
  const code = await createAuthorizationCode({
    clientId,
    userId: user.id,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod,
    resource,
  });

  // Granting an application ongoing access to your own data is exactly the
  // kind of act spec section 16 says must leave a trail. The client name
  // is recorded because "which app did I connect" is the question someone
  // will actually ask later.
  await recordAudit({
    actorId: user.id,
    action: "mcp.oauth.granted",
    entityType: "OAuthClient",
    entityId: clientId,
    after: { clientName: client.clientName, scope, redirectUri },
    ip: req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  target.searchParams.set("code", code);
  return handOff(target);
}
