"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { updatePortalDigest, updatePortalPreferences } from "@/lib/app-domain/client-file";
import type { PortalDigest } from "@prisma/client";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "רק מנהל הלקוח יכול לשנות את ההגדרות האלה.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

// Portal phase 3. The client's two writes on their own file, and both go
// through client-file.ts, which is where the membership check lives.
// Neither action here takes a client id - there is nowhere to put one.

export async function savePreferencesAction(
  _prev: FormState | undefined,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();

  try {
    await updatePortalPreferences(user, {
      contact: String(formData.get("contact") ?? ""),
      matters: String(formData.get("matters") ?? ""),
      never: String(formData.get("never") ?? ""),
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/portal/file");
  return { ok: true };
}

export async function saveDigestAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const digest = String(formData.get("digest") || "") as PortalDigest;
  if (!["EVERY_DECISION", "WEEKLY", "MONTHLY"].includes(digest)) return { error: "בחירה לא תקינה." };

  try {
    await updatePortalDigest(user, digest);
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/portal/file");
  return { ok: true };
}
