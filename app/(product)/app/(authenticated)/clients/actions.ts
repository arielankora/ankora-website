"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { createClient, updateClient, archiveClient, restoreClient } from "@/lib/app-domain/clients";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { shekelsToMinor } from "@/lib/money";
import { createDecision, cancelDecision } from "@/lib/app-domain/decisions";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

export async function createClientAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "יש להזין שם לקוח." };

  try {
    await createClient(user, {
      name,
      legalName: String(formData.get("legalName") || ""),
      timezone: String(formData.get("timezone") || "Asia/Jerusalem"),
      primaryContact: String(formData.get("primaryContact") || ""),
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/clients");
  return { ok: true };
}

export async function updateClientAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: "לקוח לא נמצא." };

  try {
    await updateClient(user, clientId, {
      name: String(formData.get("name") || "").trim(),
      legalName: String(formData.get("legalName") || ""),
      status: formData.get("status") as any,
      timezone: String(formData.get("timezone") || ""),
      primaryContact: String(formData.get("primaryContact") || ""),
      // Portal phase 2. Empty means "cleared", not "unchanged": these
      // three are always present in the form, so an empty field is a
      // deliberate blank. shekelsToMinor already returns null for an
      // empty string.
      accountManagerId: String(formData.get("accountManagerId") || "") || null,
      whatsappNumber: String(formData.get("whatsappNumber") || "") || null,
      approvalCeilingMinor: shekelsToMinor(String(formData.get("approvalCeiling") || "")),
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/clients");
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

// App redesign (handoff README, screen 5): plain async functions (not
// <form action>) so ClientsGrid can read back success/failure and wire a
// REAL undo (restoreClientAction) into the archive toast - same pattern
// as tasks/actions.ts's toggleTaskDoneAction from the daily-screens phase.
export async function archiveClientAction(clientId: string) {
  const user = await requireUser();
  try {
    await archiveClient(user, clientId);
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
  revalidatePath("/app/clients");
  return { ok: true as const };
}

export async function restoreClientAction(clientId: string) {
  const user = await requireUser();
  try {
    await restoreClient(user, clientId);
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
  revalidatePath("/app/clients");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Portal phase 2: decisions, from Ankora's side.
// ---------------------------------------------------------------------------

/// The three option rows the panel renders, read back by index. The
/// "recommended" radio carries the index of the option it marks, which is
/// how one radio group expresses "at most one recommendation" without a
/// second field per option.
function readOptions(formData: FormData) {
  const recommendedIndex = String(formData.get("recommended") || "");
  return [0, 1, 2]
    .map((i) => ({
      label: String(formData.get(`optionLabel${i}`) || ""),
      amountMinor: shekelsToMinor(String(formData.get(`optionAmount${i}`) || "")),
      recommended: recommendedIndex === String(i),
    }))
    .filter((o) => o.label.trim().length > 0);
}

export async function createDecisionAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: "לקוח לא נמצא." };

  const dueAtRaw = String(formData.get("dueAt") || "");

  try {
    await createDecision(user, {
      clientId,
      question: String(formData.get("question") || ""),
      background: String(formData.get("background") || ""),
      amountMinor: shekelsToMinor(String(formData.get("amount") || "")),
      // A date input gives a calendar day with no time. Read as the end of
      // that day in Israel, because "by Thursday" means Thursday, not
      // Thursday at midnight UTC - which is Wednesday evening here.
      dueAt: dueAtRaw ? new Date(`${dueAtRaw}T23:59:00+03:00`) : null,
      options: readOptions(formData),
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath(`/app/clients/${clientId}`);
  revalidatePath("/app/portal");
  revalidatePath("/app/portal/decisions");
  return { ok: true };
}

export async function cancelDecisionAction(input: { decisionId: string }) {
  const user = await requireUser();
  try {
    const decision = await cancelDecision(user, input.decisionId);
    revalidatePath(`/app/clients/${decision.clientId}`);
    revalidatePath("/app/portal/decisions");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: friendlyError(err) };
  }
}
