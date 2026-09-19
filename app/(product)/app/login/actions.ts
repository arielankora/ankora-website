"use server";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { rateLimit, clientIpFrom } from "@/lib/rate-limit";

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

export async function loginAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const ip = clientIpFrom(headers());
  if (!rateLimit(`app-login:${ip}`, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS).allowed) {
    return { error: GENERIC_ERROR };
  }

  const identifier = String(formData.get("identifier") || "");
  const password = String(formData.get("password") || "");

  try {
    await signIn("credentials", { identifier, password, redirectTo: "/app" });
    return {};
  } catch (err) {
    if (err instanceof AuthError) {
      // Deliberately generic per spec section 20: never reveal whether the
      // email exists, is locked out, or the password was wrong.
      return { error: GENERIC_ERROR };
    }
    throw err;
  }
}
