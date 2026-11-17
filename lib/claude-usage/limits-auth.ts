import "server-only";
import crypto from "crypto";

// Claude usage measurement, way 3 (17.11.2026): the shared secret the Ankora
// browser extension sends with each reading. Its own secret, apart from the
// telemetry ones, because it reaches every employee's browser through a
// Chrome policy. Compared in constant time over fixed-length digests, like
// lib/cron-auth.ts and lib/claude-usage/otel-auth.ts.

function constantTimeEquals(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

export type LimitsAuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string };

export function authorizeLimitsRequest(request: Request): LimitsAuthResult {
  const secret = process.env.CLAUDE_LIMITS_SECRET;
  if (!secret) return { ok: false, status: 503, error: "Limit intake is not configured" };
  const header = request.headers.get("authorization") ?? "";
  if (!constantTimeEquals(header, `Bearer ${secret}`)) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}
