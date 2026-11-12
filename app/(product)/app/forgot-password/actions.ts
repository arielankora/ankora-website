"use server";
import { headers } from "next/headers";
import { requestPasswordReset } from "@/lib/app-auth/password-reset";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { devOnly } from "@/lib/env";

// Security review (OWASP API4:2023 - Unrestricted Resource Consumption).
// Unauthenticated, and every call that matches a real account writes a
// PasswordResetToken row. With no ceiling that is unbounded database
// growth on demand, and - now that the link is actually mailed -
// an unbounded mail bomb aimed at any address the attacker knows, sent
// from Ankora's own domain. Neither needs the attacker to know a single
// password.
//
// 5 requests per IP per 15 minutes. A genuine user who mistypes their
// address and retries a few times never notices.
const RESET_REQUEST_LIMIT = 5;
const RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const RESET_ACCOUNT_LIMIT = 3;

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
  if (!(await checkRateLimit(`forgot-password:${ip}`, RESET_REQUEST_LIMIT, RESET_REQUEST_WINDOW_MS)).allowed) {
    // Returns the same "submitted" shape as the success path. Spec 20's
    // don't-reveal-anything rule applies to the rate limit too: a
    // distinct "you are being throttled" response would tell an attacker
    // the threshold and let them pace themselves under it.
    return { submitted: true };
  }

  const identifier = String(formData.get("identifier") || "");

  // 12.11.2026: the reset is now actually mailed, so the per-IP ceiling
  // above is no longer enough on its own. Rotating addresses would let
  // anyone fill one person's inbox from Ankora's domain. Three requests
  // per account per window is more than a real person ever needs, and the
  // answer stays the same "submitted" shape so it reveals nothing.
  const account = identifier.trim().toLowerCase();
  if (
    account &&
    !(await checkRateLimit(`forgot-password:account:${account}`, RESET_ACCOUNT_LIMIT, RESET_REQUEST_WINDOW_MS)).allowed
  ) {
    return { submitted: true };
  }

  const raw = await requestPasswordReset(identifier);

  // Spec section 20: never reveal whether the account exists - the UI
  // shows the same "check your inbox" message either way. The link is
  // mailed by requestPasswordReset; it is also surfaced here ONLY outside
  // production, so the flow stays testable without reading a real inbox.
  const devLink = raw ? devOnly(`/app/reset-password?token=${raw}`) : undefined;

  return { submitted: true, devLink };
}
