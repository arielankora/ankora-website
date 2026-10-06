import { can } from "@/lib/app-auth/permissions";
import { beginPasskeyRegistration, relyingPartyFor } from "@/lib/app-auth/passkeys";
import { StepUpFailedError, StepUpLockedError } from "@/lib/app-auth/step-up";
import { json, openJsonRoute } from "@/lib/app-auth/json-route";

// Step 1 of adding a passkey. Requires the Ankora password, typed now
// (lib/app-auth/passkeys.ts, rule 1).

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const opened = await openJsonRoute(req);
  if (!opened.ok) return opened.response;
  const { user, body } = opened;
  if (!can(user.role, "credential.reveal")) return json({ error: "forbidden" }, 403);
  if (typeof body.password !== "string" || body.password.length > 1024) return json({ error: "bad_request" }, 400);
  try {
    const options = await beginPasskeyRegistration(user, body.password, relyingPartyFor(req.headers));
    return json(options, 200);
  } catch (err) {
    if (err instanceof StepUpLockedError) return json({ error: "locked", message: err.message }, 429);
    if (err instanceof StepUpFailedError) return json({ error: "wrong_password", message: err.message }, 401);
    throw err;
  }
}
