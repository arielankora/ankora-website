"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { decideApproval, type DecideInput } from "@/lib/app-domain/decide-approval";
import { approveRulesTogether } from "@/lib/app-domain/process-next-steps";

// The buttons on "אישורים" (lib/approvals.ts). Nothing here decides on
// its own: lib/app-domain/decide-approval.ts sends each kind through the
// same domain function the screen it came from calls, with the same
// checks and the same audit row, and Claude's decide_approval calls it too.

export type { DecideInput };

async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("approvals.errors");
  if (err instanceof ForbiddenError) return t("forbidden");
  const coded = await domainErrorText(err);
  if (coded) return coded;
  // Refusals from domains not yet given codes keep their own sentence.
  if (err instanceof Error) return err.message;
  return t("generic");
}

export async function decideApprovalAction(input: DecideInput): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireUser();
  try {
    await decideApproval(user, input);
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  // The menu's count lives in the layout.
  revalidatePath("/app", "layout");
  if (input.clientId) revalidatePath(`/app/clients/${input.clientId}`);
  return { ok: true };
}

/// "לאשר את כל הכללים של NUX": each one through approveClientPolicy.
export async function approveRulesTogetherAction(clientId: string, ids: string[]): Promise<{ error?: string; approved?: number; failed?: string[] }> {
  const user = await requireUser();
  try {
    const r = await approveRulesTogether(user, clientId, ids);
    revalidatePath("/app", "layout");
    revalidatePath(`/app/clients/${clientId}`);
    return r;
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}
