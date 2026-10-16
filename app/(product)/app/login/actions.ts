"use server";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { safeCallbackUrl } from "@/lib/app-auth/callback-url";
import { authenticateWithPassword } from "@/lib/app-auth/authenticate";
import { PasskeyError, relyingPartyFor } from "@/lib/app-auth/passkeys";
import {
  SecondFactorError,
  enrollmentOptionsForLogin,
  finishLoginEnrollment,
  passkeyOptionsForLogin,
  startPendingLogin,
  verifyLoginPasskey,
} from "@/lib/app-auth/second-factor";

// Security review (OWASP A07:2021 - Identification and Authentication
// Failures). lib/app-auth/login-attempts.ts's graduated lockout is
// per-USER-ACCOUNT: five failures against one account locks that account.
// That stops vertical brute force, but does nothing about password
// SPRAYING - one attempt each against a thousand accounts never trips any
// single account's counter, and "Winter2026!" against a thousand users is
// how real credential attacks against small-team SaaS actually succeed.
//
// A per-IP ceiling closes that gap: 20 login attempts per IP per 15
// minutes. High enough that a whole office behind one NAT'd IP logging in
// each morning is never affected, low enough that a spray is no longer
// economical. The two limits compose - an attacker now needs both many
// accounts AND many source IPs.
//
// See lib/rate-limit.ts for why the in-memory counter is a real speed
// bump rather than a guarantee on serverless, and what the durable fix is.
const LOGIN_IP_LIMIT = 20;
const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;

// Same string the credential-failure path returns. Spec section 20: never
// reveal whether the email exists, is locked out, or the password was
// wrong - and by the same logic, a rate-limited caller should not learn
// that they specifically tripped a limit, which would tell them the
// threshold and let them tune their rate to stay under it.
const GENERIC_ERROR = "פרטי ההתחברות שגויים, או שהחשבון חסום זמנית.";

/// This deployment's own origin, from the proxy headers Vercel sets.
/// Used only to recognise an absolute callbackUrl as our own - never to
/// build a destination.
async function selfOrigin(): Promise<string | undefined> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return undefined;
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}

export type LoginState = {
  error?: string;
  /// Set when the password was right and a passkey step follows.
  step?: "passkey" | "enroll";
  token?: string;
  callbackUrl?: string;
};

export async function loginAction(_prevState: LoginState | undefined, formData: FormData): Promise<LoginState> {
  const ip = clientIpFrom(await headers());
  if (!(await checkRateLimit(`app-login:${ip}`, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS)).allowed) {
    return { error: GENERIC_ERROR };
  }

  const identifier = String(formData.get("identifier") || "");
  const password = String(formData.get("password") || "");
  const callbackUrl = safeCallbackUrl(formData.get("callbackUrl"), await selfOrigin());

  // The first step only. A right password produces a pending sign-in, not
  // a session (lib/app-auth/second-factor.ts).
  const user = await authenticateWithPassword(identifier, password, { recordSuccess: false });
  if (!user) return { error: GENERIC_ERROR };

  const { token, step } = await startPendingLogin(user, "password");
  if (step !== "none") return { step, token, callbackUrl };
  return completeSignIn(token, callbackUrl);
}

/// Hands a satisfied pending sign-in to Auth.js, which redirects on
/// success. Shared by every path that ends a sign-in.
async function completeSignIn(token: string, callbackUrl: string): Promise<LoginState> {
  try {
    await signIn("pending-login", { token, redirectTo: callbackUrl });
    return {};
  } catch (err) {
    if (err instanceof AuthError) return { error: "פג תוקף הכניסה. התחילו שוב מהסיסמה." };
    throw err;
  }
}

// ── The passkey step ──────────────────────────────────────────────────
//
// Called from the browser with the token from loginAction. Each one
// re-checks the token; none of them trusts the browser's word that an
// earlier step happened.

type StepResult<T> = { ok: true; options: T } | { ok: false; error: string };

function stepError(err: unknown): { ok: false; error: string } {
  if (err instanceof SecondFactorError) return { ok: false, error: err.message };
  throw err;
}

export async function passkeyLoginOptionsAction(token: string): Promise<StepResult<unknown>> {
  try {
    return { ok: true, options: await passkeyOptionsForLogin(String(token), relyingPartyFor(await headers())) };
  } catch (err) {
    if (err instanceof PasskeyError) return { ok: false, error: err.message };
    return stepError(err);
  }
}

export async function passkeyLoginVerifyAction(token: string, response: unknown, callbackUrl: string): Promise<LoginState> {
  try {
    await verifyLoginPasskey(String(token), response as any, relyingPartyFor(await headers()));
  } catch (err) {
    const e = stepError(err);
    return { error: e.error };
  }
  return completeSignIn(String(token), safeCallbackUrl(callbackUrl, await selfOrigin()));
}

export async function enrollOptionsAction(token: string): Promise<StepResult<unknown>> {
  try {
    return { ok: true, options: await enrollmentOptionsForLogin(String(token), relyingPartyFor(await headers())) };
  } catch (err) {
    return stepError(err);
  }
}

export async function enrollFinishAction(token: string, response: unknown, name: string, callbackUrl: string): Promise<LoginState> {
  try {
    await finishLoginEnrollment(String(token), response as any, String(name ?? ""), relyingPartyFor(await headers()));
  } catch (err) {
    const e = stepError(err);
    return { error: e.error };
  }
  return completeSignIn(String(token), safeCallbackUrl(callbackUrl, await selfOrigin()));
}
