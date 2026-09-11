"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { changeOwnPassword, updateOwnTimezone } from "@/lib/app-domain/profile";

type FormState = { error?: string; ok?: boolean };

export async function changePasswordAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!currentPassword || !newPassword) return { error: "יש למלא את כל השדות." };
  if (newPassword !== confirmPassword) return { error: "אימות הסיסמה אינו תואם." };

  const result = await changeOwnPassword(user, currentPassword, newPassword);
  if (!result.ok) return { error: result.error };

  // Password change invalidates every session, including this one (spec
  // 4.2's "logout all sessions" semantics - see profile.ts's comment).
  // Redirect straight to login rather than leaving the user on a page
  // whose session is already dead server-side.
  redirect("/app/login?passwordChanged=1");
}

export async function updateTimezoneAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const timezone = String(formData.get("timezone") || "");

  try {
    await updateOwnTimezone(user, timezone);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "אירעה שגיאה. נסו שוב." };
  }

  revalidatePath("/app/profile");
  return { ok: true };
}
