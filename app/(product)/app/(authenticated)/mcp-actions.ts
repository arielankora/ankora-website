"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { revokeMyClaudeGrant } from "@/lib/app-domain/mcp-connections";

// Lives in the route group rather than beside a single page because the
// card that calls it renders on two of them (/app/profile and
// /app/integrations). Putting it next to either one would make the other
// import across route folders for no reason.

export type RevokeActionState = { ok: true; revoked: number } | { ok: false; error: string };

/// Revokes one of the CALLING user's own Claude grants. There is no
/// userId parameter and there will not be one: acting on someone else's
/// grant goes through the admin path on the user detail screen, which is
/// permission-gated and audited as a different action. A single action
/// that could do either would put "whose credential is this" into a form
/// field.
export async function revokeMyClaudeGrantAction(grantId: string): Promise<RevokeActionState> {
  const actor = await requireUser();
  const result = await revokeMyClaudeGrant(actor, grantId);

  if (result.ok) {
    revalidatePath("/app/profile");
    revalidatePath("/app/integrations");
  }

  return result;
}
