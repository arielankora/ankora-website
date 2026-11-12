import { getTranslations } from "next-intl/server";
import { authErrorText } from "@/lib/i18n/auth-errors";
import { can } from "@/lib/app-auth/permissions";
import { finishPasskeyStepUp, relyingPartyFor, PasskeyError } from "@/lib/app-auth/passkeys";
import { StepUpFailedError, StepUpLockedError } from "@/lib/app-auth/step-up";
import { json, openJsonRoute } from "@/lib/app-auth/json-route";

// "Verify it's you" with a passkey, step 2: the signed answer. Opens the
// same five-minute window a password step-up opens, marked "passkey".

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const opened = await openJsonRoute(req);
  if (!opened.ok) return opened.response;
  const { user, body } = opened;
  if (!can(user.role, "credential.reveal")) return json({ error: "forbidden" }, 403);
  try {
    const grant = await finishPasskeyStepUp(user, body.response as any, relyingPartyFor(req.headers));
    return json({ ok: true, expiresAt: grant.expiresAt.toISOString() }, 200);
  } catch (err) {
    if (err instanceof StepUpLockedError) return json({ error: "locked", message: await authErrorText(err) }, 429);
    if (err instanceof StepUpFailedError) return json({ error: "passkey_failed", message: (await getTranslations("auth.errors"))("stepUp.verify_failed") }, 401);
    if (err instanceof PasskeyError) return json({ error: "passkey_failed", message: await authErrorText(err) }, 400);
    throw err;
  }
}
