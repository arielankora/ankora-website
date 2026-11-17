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

/// Each sender has its own secret, so one can be replaced without the
/// other (17.11.2026):
///   COWORK_OTEL_SECRET       Cowork, set in claude.ai's organization settings
///   CLAUDE_CODE_OTEL_SECRET  Claude Code, pushed to every machine and cloud
///                            session through Claude Code's managed settings,
///                            so it travels further and is kept apart
/// A request carrying either is let in. Which one it was is not kept: the
/// events say which product sent them (service.name).
const SECRET_ENVS = ["COWORK_OTEL_SECRET", "CLAUDE_CODE_OTEL_SECRET"] as const;

export function authorizeOtelRequest(request: Request): OtelAuthResult {
  const secrets = SECRET_ENVS.map((name) => process.env[name]).filter((v): v is string => !!v);
  // Not configured yet: say so plainly. 503 tells the exporter to try
  // later, so nothing is lost while the setting is half done.
  if (secrets.length === 0) return { ok: false, status: 503, error: "Telemetry intake is not configured" };
  const header = request.headers.get("authorization") ?? "";
  // Every secret is compared, so the time taken does not say which matched.
  let ok = false;
  for (const secret of secrets) if (constantTimeEquals(header, `Bearer ${secret}`)) ok = true;
  if (!ok) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}
