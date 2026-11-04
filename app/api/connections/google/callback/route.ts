import { cookies } from "next/headers";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { exchangeCode, NONCE_COOKIE, readState } from "@/lib/google-oauth";
import { addGoogleConnection } from "@/lib/app-domain/connections";

// Google sends the person back here after the consent screen. The state
// must be signed, fresh, started by this same person, and match the nonce
// cookie of this browser; otherwise nothing is stored.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response("unauthorized", { status: 401 });
    throw err;
  }
  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value;
  jar.delete({ name: NONCE_COOKIE, path: "/api/connections/google" });
  const state = readState(url.searchParams.get("state") ?? "", nonce);
  if (!state || state.userId !== user.id) return new Response("bad state", { status: 400 });
  const back = (q: string) => Response.redirect(new URL(`/app/clients/${state.clientId}/connections?${q}`, url.origin), 303);
  if (url.searchParams.get("error")) return back("error=denied");
  const code = url.searchParams.get("code");
  if (!code) return back("error=denied");
  try {
    const tokens = await exchangeCode({ code, origin: url.origin });
    if (!tokens.refreshToken || !tokens.email) return back("error=no_token");
    await addGoogleConnection(user, { clientId: state.clientId, purpose: state.purpose, account: tokens.email, refreshToken: tokens.refreshToken, scopes: tokens.scopes });
  } catch {
    return back("error=failed");
  }
  return back("connected=1");
}
