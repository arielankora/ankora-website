import "server-only";
import { prisma } from "@/lib/prisma";
import { clientIpFrom } from "@/lib/rate-limit";

// Spec section 16 "Audit שאסור לוותר עליו" / section 0: every action that
// changes a user, client, or access/role must be auditable. This is a thin
// wrapper so every call site records the same shape consistently - no
// silent updates that skip the trail.
//
// IP and browser: the audit_events table has had `ip` and `userAgent`
// columns since Phase 1, but only one of ~70 call sites ever passed them,
// so in practice every row, logins included, was stored without them. The
// customer DPA (Annex II, "Logging and Monitoring") commits to recording
// "IP address and browser where applicable". Rather than threading two
// more arguments through every call site, the wrapper now reads them from
// the current request itself. "Where applicable" is exactly what the
// try/catch below expresses: outside a request (cron jobs, the nightly
// backup, scripts) `headers()` throws, and those rows stay null, which is
// correct because there is no browser behind them.
//
// An explicit value from the caller always wins, including an explicit
// null.
async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const ip = clientIpFrom(h);
    const ua = h.get("user-agent");
    return {
      ip: ip === "unknown" ? null : ip,
      userAgent: ua ? ua.slice(0, 512) : null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function recordAudit(params: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  clientId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const needsContext = params.ip === undefined || params.userAgent === undefined;
  const ctx = needsContext ? await requestContext() : { ip: null, userAgent: null };

  await prisma.auditEvent.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      clientId: params.clientId ?? null,
      beforeJson: params.before === undefined ? undefined : (params.before as any),
      afterJson: params.after === undefined ? undefined : (params.after as any),
      ip: params.ip !== undefined ? params.ip : ctx.ip,
      userAgent: params.userAgent !== undefined ? params.userAgent : ctx.userAgent,
    },
  });
}
