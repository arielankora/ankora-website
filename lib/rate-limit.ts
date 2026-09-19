import "server-only";

// Security review (OWASP A07:2021 - Identification and Authentication
// Failures; OWASP API4:2023 - Unrestricted Resource Consumption).
//
// Before this module, the ONLY brute-force protection anywhere in the
// codebase was lib/app-auth/login-attempts.ts's per-USER-ACCOUNT graduated
// lockout. That stops vertical brute force against one known account, but
// leaves three surfaces completely unprotected:
//
//   1. POST /api/admin/login - a single shared password, no account to
//      lock, unlimited attempts. This is the highest-value target in the
//      app: the blog admin session it grants can publish/update/DELETE
//      files in the GitHub repo through a contents:write token.
//   2. POST /api/contact - unauthenticated, and every call sends a real
//      email through Resend. An open relay for spam and for burning the
//      Resend quota.
//   3. /app/forgot-password - unauthenticated, writes a PasswordResetToken
//      row per call. Unlimited rows, and once an email provider is wired
//      up (Phase 4), unlimited mail to a victim's inbox.
//
// It also does not stop password SPRAYING against /app/login: one attempt
// each against a thousand accounts never trips any single account's
// 5-failure counter.
//
// HONEST LIMITATION - read before relying on this. The counters live in
// this Node process's memory. Vercel runs each route in serverless
// instances that scale out and are recycled, so a determined attacker
// distributing requests across instances gets more attempts than the
// numbers below suggest, and a cold start resets the window. This is a
// real, meaningful speed bump (it collapses the trivial "10k guesses/min
// from one script" case), not a hard guarantee.
//
// The durable fix is edge-level rate limiting - Vercel's WAF rate-limit
// rules, or Upstash/Redis-backed counters shared across instances. Both
// need a plan/account decision that belongs to Ariel, so this ships as
// the zero-dependency, zero-cost layer that works today. See the security
// review PR description for the recommendation.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bound the map so a high-cardinality key space (one entry per attacking
// IP) can't grow into a memory-exhaustion vector of its own.
const MAX_BUCKETS = 10_000;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    // Still over budget after dropping expired entries - drop the oldest
    // live ones. Map preserves insertion order, so this evicts the
    // longest-standing windows first.
    const excess = buckets.size - MAX_BUCKETS;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

export interface RateLimitResult {
  /// False when the caller has exhausted its allowance for the current window.
  allowed: boolean;
  /// Attempts left in the current window (0 when blocked).
  remaining: number;
  /// Seconds until the window resets - suitable for a Retry-After header.
  retryAfterSeconds: number;
}

/// Fixed-window counter. `key` should already be namespaced by caller
/// (e.g. `admin-login:1.2.3.4`) so two different endpoints never share a
/// budget.
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds };
}

/// Best-effort client IP. On Vercel, `x-forwarded-for` is set by the edge
/// and its LEFTMOST entry is the real client - trusting the rightmost (or
/// the whole string) would let a caller pin themselves to a fresh bucket
/// on every request by sending their own header. `x-real-ip` is Vercel's
/// own single-value equivalent and is preferred when present.
///
/// Returns "unknown" when neither header is present (local dev), which
/// deliberately puts all such callers in ONE shared bucket rather than
/// silently disabling the limit.
export function clientIpFrom(headers: Headers): string {
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}

/// Convenience wrapper for Route Handlers: returns a ready 429 Response
/// when the caller is over budget, or null when the request may proceed.
export function rateLimitResponse(
  headers: Headers,
  namespace: string,
  limit: number,
  windowMs: number
): Response | null {
  const result = rateLimit(`${namespace}:${clientIpFrom(headers)}`, limit, windowMs);
  if (result.allowed) return null;

  return Response.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        // Do not let a 429 be cached and served to an innocent third party.
        "Cache-Control": "no-store",
      },
    }
  );
}

/// Test-only: drop all state so one test's counters can't leak into the next.
export function __resetRateLimitsForTests() {
  buckets.clear();
}
