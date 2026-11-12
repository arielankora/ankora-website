"use server";
import { getTranslations } from "next-intl/server";
import { consumePasswordResetToken } from "@/lib/app-auth/password-reset";
import { PASSWORD_MIN_LENGTH } from "@/lib/app-auth/password";

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
  const t = await getTranslations("auth.reset.errors");

  if (password !== confirm) {
    return { error: t("mismatch") };
  }

  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) {
    return { error: result.code === "password_too_short" ? t(result.code, { min: PASSWORD_MIN_LENGTH }) : t(result.code) };
  }
  return { done: true };
}
