import { cookies } from "next/headers";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { authUrl, googleOAuthConfig, newNonce, NONCE_COOKIE, signState, type OAuthPurpose } from "@/lib/google-oauth";

// Starts a client connection on Google's own consent screen (ADR 0001
// section 24, task cmvtivumj000pjs08q9qj4t67). The callback trusts only a
// signed state whose nonce is also in this browser's cookie.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response("unauthorized", { status: 401 });
    throw err;
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  const purpose = (url.searchParams.get("purpose") === "SEND" ? "SEND" : "CLIENT") as OAuthPurpose;
  const cfg = googleOAuthConfig();
  if (!cfg || !/^[A-Za-z0-9_-]{1,40}$/.test(clientId)) {
    return Response.redirect(new URL(`/app/clients/${encodeURIComponent(clientId)}/connections?error=not_configured`, url.origin), 303);
  }
  const nonce = newNonce();
  (await cookies()).set(NONCE_COOKIE, nonce, { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/connections/google", maxAge: 600 });
  const state = signState({ clientId, userId: user.id, purpose, nonce, exp: Date.now() + 10 * 60 * 1000 });
  return Response.redirect(authUrl({ clientId: cfg.clientId, origin: url.origin, purpose, state }), 303);
}
