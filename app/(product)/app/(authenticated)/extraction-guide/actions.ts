"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { approveGuide, proposeGuide, rejectGuide } from "@/lib/app-domain/extraction-guide";

// Org brain, decision 3: propose, approve and reject versions of the
// extraction guidance.

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "רק מנהל מאשר או דוחה גרסה של ההנחיות.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

async function run(fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath("/app/extraction-guide");
  return { ok: true };
}

export async function proposeGuideAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => proposeGuide(user, { body: String(formData.get("body") ?? ""), note: String(formData.get("note") ?? "") }));
}

export async function approveGuideAction(id: string): Promise<FormState> {
  const user = await requireUser();
  return run(() => approveGuide(user, id));
}

export async function rejectGuideAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => rejectGuide(user, String(formData.get("id") ?? ""), String(formData.get("reason") ?? "")));
}
