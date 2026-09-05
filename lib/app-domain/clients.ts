import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import type { User, ClientStatus } from "@prisma/client";

export async function listClients() {
  return prisma.client.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { employeeAccess: true, categories: true } } },
  });
}

/// Phase 2 (spec 4.1: "אסור לעובד לדווח זמן ללקוח שאינו משויך אליו").
/// Powers the client picker on /app/timer and /app/my-time - admins/
/// managers (client.manage) see every active client, everyone else only
/// the clients they hold a UserClientAccess row for.
export async function listAccessibleClients(actor: User) {
  if (canManageClients(actor.role)) {
    return prisma.client.findMany({
      where: { deletedAt: null, status: "ACTIVE" },
      orderBy: { name: "asc" },
    });
  }
  const access = await prisma.userClientAccess.findMany({
    where: { userId: actor.id },
    include: { client: true },
    orderBy: { client: { name: "asc" } },
  });
  return access.map((a) => a.client).filter((c) => !c.deletedAt && c.status === "ACTIVE");
}

export async function getClient(id: string) {
  return prisma.client.findFirst({
    where: { id, deletedAt: null },
    include: { employeeAccess: { include: { user: true } }, categories: true },
  });
}

export async function createClient(
  actor: User,
  input: { name: string; legalName?: string; timezone?: string; primaryContact?: string }
) {
  assertCan(actor.role, "client.manage");
  const client = await prisma.client.create({
    data: {
      name: input.name.trim(),
      legalName: input.legalName?.trim() || null,
      timezone: input.timezone || "Asia/Jerusalem",
      primaryContact: input.primaryContact?.trim() || null,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client.create",
    entityType: "Client",
    entityId: client.id,
    clientId: client.id,
    after: client,
  });
  return client;
}

export async function updateClient(
  actor: User,
  clientId: string,
  input: { name?: string; legalName?: string; status?: ClientStatus; timezone?: string; primaryContact?: string }
) {
  assertCan(actor.role, "client.manage");
  const before = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      name: input.name?.trim(),
      legalName: input.legalName?.trim(),
      status: input.status,
      timezone: input.timezone,
      primaryContact: input.primaryContact?.trim(),
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client.settings_change",
    entityType: "Client",
    entityId: clientId,
    clientId,
    before,
    after: client,
  });
  return client;
}

/// Soft delete only - spec 5.1: "מחיקה היא soft delete; לא hard delete
/// דרך UI."
export async function archiveClient(actor: User, clientId: string) {
  assertCan(actor.role, "client.manage");
  const client = await prisma.client.update({
    where: { id: clientId },
    data: { status: "ARCHIVED", deletedAt: new Date() },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client.archive",
    entityType: "Client",
    entityId: clientId,
    clientId,
  });
  return client;
}
