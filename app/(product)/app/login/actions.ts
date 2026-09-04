"use server";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";

export async function loginAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const identifier = String(formData.get("identifier") || "");
  const password = String(formData.get("password") || "");

  try {
    await signIn("credentials", { identifier, password, redirectTo: "/app" });
    return {};
  } catch (err) {
    if (err instanceof AuthError) {
      // Deliberately generic per spec section 20: never reveal whether the
      // email exists, is locked out, or the password was wrong.
      return { error: "פרטי ההתחברות שגויים, או שהחשבון חסום זמנית." };
    }
    throw err;
  }
}
