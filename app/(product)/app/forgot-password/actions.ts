"use server";
import { requestPasswordReset } from "@/lib/app-auth/password-reset";

export type ForgotPasswordState = { submitted?: boolean; devLink?: string };

// Explicit return type keeps this a single flat optional-keys shape -
// without it, TS infers the literal `{ submitted: true; devLink: ... }`
// object shape from the return statement, which then makes
// `useFormState(forgotPasswordAction, {})` fail to type-check (an empty
// initial object doesn't satisfy required keys).
export async function forgotPasswordAction(
  _prev: ForgotPasswordState | undefined,
  formData: FormData
): Promise<ForgotPasswordState> {
  const identifier = String(formData.get("identifier") || "");
  const raw = await requestPasswordReset(identifier);

  // Spec section 20: never reveal whether the account exists - the UI
  // shows the same "check your inbox" message either way. Because there is
  // no email provider yet (Phase 4), the raw link is surfaced here ONLY
  // when running outside production, so the flow is testable end-to-end
  // today without pretending an email was actually sent to a real user.
  const devLink =
    raw && process.env.NODE_ENV !== "production" ? `/app/reset-password?token=${raw}` : undefined;

  return { submitted: true, devLink };
}
