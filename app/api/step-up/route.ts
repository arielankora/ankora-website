import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { stepUpWithPassword, StepUpFailedError, StepUpLockedError } from "@/lib/app-auth/step-up";
import { isSameOriginJsonPost } from "@/lib/same-origin";

// "Verify it's you" for the credentials vault. Opens a five-minute window
// (lib/app-auth/step-up.ts). Returns only when it expires - never the
// password, never a token.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(req: Request) {
  if (!isSameOriginJsonPost(req)) return json({ error: "bad_request" }, 400);

  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return json({ error: "unauthorized" }, 401);
    throw err;
  }
  if (!can(user.role, "credential.reveal")) return json({ error: "forbidden" }, 403);

  let password: unknown;
  try {
    password = ((await req.json()) as { password?: unknown }).password;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof password !== "string" || password.length > 1024) return json({ error: "bad_request" }, 400);

  try {
    const grant = await stepUpWithPassword(user, password);
    return json({ ok: true, expiresAt: grant.expiresAt.toISOString() }, 200);
  } catch (err) {
    if (err instanceof StepUpLockedError) return json({ error: "locked", message: err.message }, 429);
    if (err instanceof StepUpFailedError) return json({ error: "wrong_password", message: err.message }, 401);
    throw err;
  }
}
