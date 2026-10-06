import { can } from "@/lib/app-auth/permissions";
import { beginPasskeyStepUp, relyingPartyFor, PasskeyError } from "@/lib/app-auth/passkeys";
import { StepUpLockedError } from "@/lib/app-auth/step-up";
import { json, openJsonRoute } from "@/lib/app-auth/json-route";

// "Verify it's you" with a passkey, step 1: a single-use challenge.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const opened = await openJsonRoute(req);
  if (!opened.ok) return opened.response;
  const { user } = opened;
  if (!can(user.role, "credential.reveal")) return json({ error: "forbidden" }, 403);
  try {
    return json(await beginPasskeyStepUp(user, relyingPartyFor(req.headers)), 200);
  } catch (err) {
    if (err instanceof StepUpLockedError) return json({ error: "locked", message: err.message }, 429);
    if (err instanceof PasskeyError) return json({ error: "passkey_failed", message: err.message }, 400);
    throw err;
  }
}
