import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveInternalClient } from "@/lib/app-domain/employee-lifecycle";

/// Whether this is Ankora's own file, "Ankora פנימי": the flag, or the
/// client the employee lifecycle names (by env or by name), in case the
/// flag was never set on it. Its own module, so the source rules
/// (client-sources.ts) can ask without importing internal-client.ts,
/// which imports them.
export async function isInternalClient(clientId: string): Promise<boolean> {
  const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { id: true, isInternal: true } });
  if (!client) return false;
  if (client.isInternal) return true;
  const named = await resolveInternalClient().catch(() => null);
  return named?.id === client.id;
}
