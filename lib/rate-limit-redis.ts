import "server-only";

// Shared, cross-instance rate-limit counters backed by Upstash Redis.
//
// Why this exists: lib/rate-limit.ts keeps its counters in each serverless
// instance's memory. Vercel scales instances out and recycles them, so an
// attacker distributing requests across instances gets more attempts than
// the configured numbers suggest, and a cold start resets the window. That
// was documented as a known limitation of the first security pass; this
// module is the durable fix Ariel chose.
//
// No new npm dependency. Upstash exposes a plain HTTPS REST API, so a
// fixed-window counter is two commands in one pipelined request, which
// `fetch` can issue directly. Given that this same review spent effort
// REMOVING vulnerable transitive dependencies (see ADR 0003), adding two
// packages and their trees to send two Redis commands would have been a
// poor trade.
//
// Configuration (both optional - see the fallback contract below):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Vercel's Upstash integration injects both automatically once the store
// is linked to the project; setting them by hand also works.

// Read at call time, never captured into module-level constants. Two
// reasons, and the second is the one that bit: a module-level const is
// frozen at first import, so it cannot be exercised by a test that sets
// the variables afterwards - which meant the fallback path could not be
// proven to work. Reading per call also keeps this consistent with
// isRedisRateLimitConfigured() below, which always read freshly. The cost
// is two property lookups per request.
function redisConfig(): { endpoint: string; token: string } | null {
  const endpoint = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!endpoint || !token) return null;
  return { endpoint, token };
}

/// Whether shared counters are available at all. When false, every caller
/// falls back to the in-memory limiter, which still works - just per
/// instance.
export function isRedisRateLimitConfigured(): boolean {
  return redisConfig() !== null;
}

// A login must not hang because Redis is slow. If the round trip has not
// finished in this long, we stop waiting and let the caller fall back.
const TIMEOUT_MS = 800;

export interface RedisRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/// Fixed-window counter, matching lib/rate-limit.ts's semantics exactly so
/// the two are interchangeable.
///
/// Returns null - never throws, and never blocks - when Redis is not
/// configured, times out, or errors. Null means "no answer", and the
/// caller falls back to the in-memory counter.
///
/// That fallback direction is a deliberate availability choice, and worth
/// being explicit about: if Upstash is down, this degrades to per-instance
/// limiting rather than locking every user out of the product. A rate
/// limiter that fails closed on an outage is a self-inflicted denial of
/// service, and the in-memory tier it falls back to is the same protection
/// the app shipped with before this module existed - not nothing.
export async function redisRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RedisRateLimitResult | null> {
  const config = redisConfig();
  if (!config) return null;

  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  // Bucket the key by window so the counter resets naturally and each key
  // is only ever written by one window - no read-modify-write race.
  const windowId = Math.floor(Date.now() / windowMs);
  const redisKey = `rl:${key}:${windowId}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // One round trip: increment, and set the TTL only if the key is new.
    // The NX flag matters - without it every request would push the
    // expiry forward, and a sustained attack would keep the window alive
    // indefinitely instead of letting it roll over.
    const res = await fetch(`${config.endpoint}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, String(windowSeconds), "NX"],
      ]),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) return null;

    const body = await res.json();
    // Pipeline replies come back positionally: [{result: n}, {result: 0|1}].
    const count = Array.isArray(body) ? Number(body[0]?.result) : NaN;
    if (!Number.isFinite(count)) return null;

    // Seconds remaining in this window, derived locally rather than with a
    // third TTL command - the window boundary is a pure function of the
    // clock, so this costs nothing and keeps the request to one round trip.
    const elapsedMs = Date.now() - windowId * windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));

    if (count > limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: Math.max(0, limit - count), retryAfterSeconds };
  } catch {
    // Timeout, abort, network error, malformed JSON - all the same answer:
    // no result, caller falls back. Deliberately not logged per request;
    // a broken Upstash config would otherwise flood the logs on every
    // login attempt.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
