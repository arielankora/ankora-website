import "server-only";
import crypto from "crypto";

// Claude usage measurement, stage 2 (17.11.2026): the shared secret that
// Cowork sends with every telemetry export. Ariel puts the same value in
// two places: COWORK_OTEL_SECRET in Vercel, and "OTLP headers" in claude.ai
// (Organization settings > Data and privacy > Monitoring) as
// `Authorization=Bearer <value>`.
//
// Compared in constant time over fixed-length digests, the same way as
// lib/cron-auth.ts and for the same reason.

function constantTimeEquals(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

export type OtelAuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string };

export function authorizeOtelRequest(request: Request): OtelAuthResult {
  const secret = process.env.COWORK_OTEL_SECRET;
  // Not configured yet: say so plainly. 503 tells the exporter to try
  // later, so nothing is lost while the setting is half done.
  if (!secret) return { ok: false, status: 503, error: "Telemetry intake is not configured" };
  const header = request.headers.get("authorization");
  if (!header || !constantTimeEquals(header, `Bearer ${secret}`)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}
