"use server";
import { headers } from "next/headers";
import { requestPasswordReset } from "@/lib/app-auth/password-reset";
import { rateLimit, clientIpFrom } from "@/lib/rate-limit";

// Security review (OWASP API4:2023 - Unrestricted Resource Consumption).
// Unauthenticated, and every call that matches a real account writes a
// PasswordResetToken row. With no ceiling that is unbounded database
// growth on demand, and - once an email provider is wired up (Phase 4) -
// an unbounded mail bomb aimed at any address the attacker knows, sent
// from Ankora's own domain. Neither needs the attacker to know a single
// password.
//
// 5 requests per IP per 15 minutes. A genuine user who mistypes their
// address and retries a few times never notices.
const RESET_REQUEST_LIMIT = 5;
const RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;

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
  const ip = clientIpFrom(await headers());
  if (!rateLimit(`forgot-password:${ip}`, RESET_REQUEST_LIMIT, RESET_REQUEST_WINDOW_MS).allowed) {
    // Returns the same "submitted" shape as the success path. Spec 20's
    // don't-reveal-anything rule applies to the rate limit too: a
    // distinct "you are being throttled" response would tell an attacker
    // the threshold and let them pace themselves under it.
    return { submitted: true };
  }

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
