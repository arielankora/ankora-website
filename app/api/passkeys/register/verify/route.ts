import { can } from "@/lib/app-auth/permissions";
import { finishPasskeyRegistration, relyingPartyFor, PasskeyError } from "@/lib/app-auth/passkeys";
import { json, openJsonRoute } from "@/lib/app-auth/json-route";

// Step 2 of adding a passkey: the browser's answer to the challenge from
// step 1. Stores the public key only.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const opened = await openJsonRoute(req);
  if (!opened.ok) return opened.response;
  const { user, body } = opened;
  if (!can(user.role, "credential.reveal")) return json({ error: "forbidden" }, 403);
  try {
    await finishPasskeyRegistration(
      user,
      body.response as any,
      typeof body.name === "string" ? body.name : "",
      relyingPartyFor(req.headers),
    );
    return json({ ok: true }, 200);
  } catch (err) {
    if (err instanceof PasskeyError) return json({ error: "passkey_failed", message: err.message }, 400);
    throw err;
  }
}
