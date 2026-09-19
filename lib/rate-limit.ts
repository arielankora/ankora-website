import "server-only";
import { redisRateLimit } from "@/lib/rate-limit-redis";

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
// TWO TIERS. The counters in THIS module live in one Node process's
// memory. Vercel scales serverless instances out and recycles them, so on
// their own these let a distributed attacker get more attempts than the
// configured numbers suggest, and a cold start resets the window. That was
// the documented limitation of the first security pass.
//
// It is now closed by lib/rate-limit-redis.ts, which keeps the same
// counters in Upstash Redis where every instance shares them.
// checkRateLimit() below prefers Redis and falls back to the in-memory
// counters here when Redis is unconfigured, slow or erroring - so this
// module is no longer the whole story, but it is still the floor, and it
// is what keeps the app protected (per-instance) during an Upstash outage
// or before the credentials are set.
//
// Enabling the shared tier needs UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN in the environment. Without them everything
// still behaves exactly as it did before, at the in-memory level.

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

/// The limiter every caller should use. Prefers the shared, cross-instance
/// Redis counters (lib/rate-limit-redis.ts) and falls back to the
/// in-memory counter above when Redis is not configured, times out, or
/// errors - see that module for why the fallback goes in that direction.
///
/// Callers await this instead of calling rateLimit() directly. The
/// in-memory function stays exported and synchronous because it is both
/// the fallback and what the unit tests exercise directly.
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const shared = await redisRateLimit(key, limit, windowMs);
  if (shared) return shared;
  return rateLimit(key, limit, windowMs);
}

/// Convenience wrapper for Route Handlers: returns a ready 429 Response
/// when the caller is over budget, or null when the request may proceed.
export async function rateLimitResponse(
  headers: Headers,
  namespace: string,
  limit: number,
  windowMs: number
): Promise<Response | null> {
  const result = await checkRateLimit(`${namespace}:${clientIpFrom(headers)}`, limit, windowMs);
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
