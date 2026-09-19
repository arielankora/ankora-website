"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { createClient, updateClient, archiveClient, restoreClient } from "@/lib/app-domain/clients";
import { ForbiddenError } from "@/lib/app-auth/permissions";

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
