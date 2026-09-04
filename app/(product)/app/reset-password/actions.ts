"use server";
import { consumePasswordResetToken } from "@/lib/app-auth/password-reset";

export type ResetPasswordState = { error?: string; done?: boolean };

// Explicit return type keeps this a single flat optional-keys shape
// instead of a union of the three distinct return-statement shapes below -
// see the identical note in forgot-password/actions.ts.
export async function resetPasswordAction(
  _prev: ResetPasswordState | undefined,
  formData: FormData
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  if (password !== confirm) {
    return { error: "הסיסמאות אינן תואמות." };
  }

  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) return { error: result.error };
  return { done: true };
}
