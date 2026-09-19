import "server-only";
import crypto from "crypto";

// Security review (OWASP A02:2021 - Cryptographic Failures; CWE-208,
// "Observable Timing Discrepancy").
//
// Both cron routes previously did:
//
//     if (authHeader !== `Bearer ${secret}`) return 401;
//
// JavaScript's `!==` on strings short-circuits at the first differing
// byte, so the time to reject a guess varies with how many leading
// characters were correct. Over the public internet that signal is
// usually buried in network jitter, but it is a free fix, and these two
// endpoints are worth the care: whoever can call them can trigger the
// nightly data export, which emails a full Excel dump of every client,
// time entry and task to a fixed address.
//
// crypto.timingSafeEqual requires equal-length buffers and throws
// otherwise, which would itself be a length oracle - so both sides are
// hashed to a fixed 32 bytes first.
function constantTimeEquals(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 500; error: string };

/// Shared bearer-token check for the Vercel Cron routes. Vercel sends
/// `Authorization: Bearer ${CRON_SECRET}` on every cron-triggered
/// request; anything else is rejected so the endpoints cannot be
/// triggered by an outside caller who does not know the secret.
export function authorizeCronRequest(request: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set");
    return { ok: false, status: 500, error: "Server not configured" };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !constantTimeEquals(authHeader, `Bearer ${secret}`)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
