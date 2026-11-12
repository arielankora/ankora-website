"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { respondToDecision } from "@/lib/app-domain/decisions";

type FormState = { error?: string; ok?: boolean };

// ADR 0006: a refusal in the reader's language. respondToDecision's own
// refusals are DomainErrors (decisions.*), worded by the dictionary.
async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("portal.errors");
  if (err instanceof ForbiddenError) return t("decisionsAdminOnly");
  const text = await domainErrorText(err);
  if (text) return text;
  if (err instanceof Error) return err.message;
  return t("generic");
}

// Portal phase 2. The client's one write.
//
// Everything that decides whether this is allowed lives in
// respondToDecision: the portal's client isolation, the read-only rule
// for a staff preview, the Client Admin check, and that the option
// belongs to this decision. This action adds no authorization of its
// own - it exists to carry a form submission and to refresh the two
// screens the answer changes.
export async function respondToDecisionAction(
  _prev: FormState | undefined,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  const decisionId = String(formData.get("decisionId") || "");
  const optionId = String(formData.get("optionId") || "");
  if (!decisionId || !optionId) return { error: (await getTranslations("portal.errors"))("noOption") };

  try {
    await respondToDecision(user, decisionId, optionId);
  } catch (err) {
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/portal/decisions");
  // The home screen counts open decisions, and answering one may also
  // have released a promise that was waiting on the client.
  revalidatePath("/app/portal");
  return { ok: true };
}
