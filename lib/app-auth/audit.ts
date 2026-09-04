import "server-only";
import { prisma } from "@/lib/prisma";

// Spec section 16 "Audit שאסור לוותר עליו" / section 0: every action that
// changes a user, client, or access/role must be auditable. This is a thin
// wrapper so every call site records the same shape consistently - no
// silent updates that skip the trail.
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
  await prisma.auditEvent.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      clientId: params.clientId ?? null,
      beforeJson: params.before === undefined ? undefined : (params.before as any),
      afterJson: params.after === undefined ? undefined : (params.after as any),
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}
