import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  revealCredential,
  CredentialNotFoundError,
  StepUpRequiredError,
  RevealRateLimitedError,
} from "@/lib/app-domain/credentials";
import { VaultKeyMismatchError, VaultUnavailableError } from "@/lib/vault/keys";
import { isSameOriginJsonPost } from "@/lib/same-origin";

// THE ONLY PATH BY WHICH A CLIENT'S USERNAME, PASSWORD OR NOTES LEAVE THE
// SERVER (claude/credentials-vault-spec-2026-10-06.md).
//
// POST only, so nothing can be prefetched, linked or cached into
// revealing it. `no-store` on every response, success or not. Nothing
// here logs the request or the response body; do not add logging
// to this file. tests/unit/vault-guards.test.ts checks that no other
// file calls revealCredential.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOriginJsonPost(req)) return json({ error: "bad_request" }, 400);

  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return json({ error: "unauthorized" }, 401);
    throw err;
  }

  const { id } = await ctx.params;
  let taskId: string | null = null;
  try {
    const body = (await req.json()) as { taskId?: unknown };
    if (typeof body.taskId === "string" && body.taskId.length > 0 && body.taskId.length < 100) taskId = body.taskId;
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  try {
    const secret = await revealCredential(user, id, { taskId });
    return json({ username: secret.username, password: secret.password, notes: secret.notes }, 200);
  } catch (err) {
    if (err instanceof CredentialNotFoundError) return json({ error: "not_found" }, 404);
    if (err instanceof StepUpRequiredError) return json({ error: "step_up_required" }, 403);
    if (err instanceof RevealRateLimitedError) return json({ error: "rate_limited", message: err.message }, 429);
    if (err instanceof ForbiddenError) return json({ error: "forbidden", message: err.message }, 403);
    if (err instanceof VaultKeyMismatchError || err instanceof VaultUnavailableError) {
      return json({ error: "vault_unavailable", message: err.message }, 503);
    }
    // Anything else - a key service outage, an authentication failure on the
    // ciphertext - is a refusal with no detail. The audit row for the
    // attempt already exists.
    return json({ error: "reveal_failed" }, 500);
  }
}
