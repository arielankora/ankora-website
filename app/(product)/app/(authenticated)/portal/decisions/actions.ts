"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { respondToDecision } from "@/lib/app-domain/decisions";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "רק מנהל הלקוח יכול לאשר החלטות.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
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
  if (!decisionId || !optionId) return { error: "לא נבחרה אפשרות." };

  try {
    await respondToDecision(user, decisionId, optionId);
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/portal/decisions");
  // The home screen counts open decisions, and answering one may also
  // have released a promise that was waiting on the client.
  revalidatePath("/app/portal");
  return { ok: true };
}
