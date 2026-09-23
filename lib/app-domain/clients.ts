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
  input: {
    name?: string;
    legalName?: string;
    status?: ClientStatus;
    timezone?: string;
    primaryContact?: string;
    // Portal phase 2. All three are nullable and `null` clears them,
    // which is why they are typed separately from the strings above -
    // "no account manager" and "unchanged" must not be the same value.
    accountManagerId?: string | null;
    whatsappNumber?: string | null;
    approvalCeilingMinor?: number | null;
    // Portal phase 3. The same three preferences the client edits on
    // their own screen. Both sides write them, because half of what is
    // worth recording here is said on a call and never typed by the
    // person who said it.
    preferenceContact?: string | null;
    preferenceMatters?: string | null;
    preferenceNever?: string | null;
  }
) {
  assertCan(actor.role, "client.manage");
  const before = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  const touchedPreferences =
    (input.preferenceContact !== undefined && (input.preferenceContact?.trim() || null) !== before.preferenceContact) ||
    (input.preferenceMatters !== undefined && (input.preferenceMatters?.trim() || null) !== before.preferenceMatters) ||
    (input.preferenceNever !== undefined && (input.preferenceNever?.trim() || null) !== before.preferenceNever);

  if (input.accountManagerId) {
    // A client user must never be set as an account manager: they would
    // then appear on their own portal as the person to talk to, and the
    // name on that card is a promise about who is accountable.
    const manager = await prisma.user.findFirst({
      where: { id: input.accountManagerId, deletedAt: null, role: { not: "CLIENT_USER" } },
    });
    if (!manager) throw new Error("מנהל התיק שנבחר אינו משתמש פעיל של Ankora.");
  }

  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      name: input.name?.trim(),
      legalName: input.legalName?.trim(),
      status: input.status,
      timezone: input.timezone,
      primaryContact: input.primaryContact?.trim(),
      accountManagerId: input.accountManagerId,
      whatsappNumber: input.whatsappNumber === null ? null : input.whatsappNumber?.trim() || undefined,
      approvalCeilingMinor: input.approvalCeilingMinor,
      preferenceContact: input.preferenceContact === null ? null : input.preferenceContact?.trim() || undefined,
      preferenceMatters: input.preferenceMatters === null ? null : input.preferenceMatters?.trim() || undefined,
      preferenceNever: input.preferenceNever === null ? null : input.preferenceNever?.trim() || undefined,
      // Only stamp the editor when a preference actually moved, so the
      // client's screen does not report "עודכן לאחרונה" because somebody
      // changed the timezone.
      ...(touchedPreferences
        ? { preferencesUpdatedAt: new Date(), preferencesUpdatedById: actor.id }
        : {}),
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

// App redesign (handoff README, screen 5 "לקוחות"): "פעולות: ... העברה
// לארכיון (עם ביטול)" - the Interactions & Behavior section requires a
// REAL undo (an actual reversing server action), not just rewinding
// client-side state. archiveClient soft-deletes (sets deletedAt), and
// every read path here (listClients, getClient, listAccessibleClients)
// filters deletedAt:null - so without this, a toast "undo" button would
// have had nothing real to call, and the client would stay invisible/
// unreachable (even its own detail page 404s) until someone manually
// fixed the row in the database. This mirrors reopenTimer's precedent in
// time-entries.ts for the same reason.
export async function restoreClient(actor: User, clientId: string) {
  assertCan(actor.role, "client.manage");
  const client = await prisma.client.update({
    where: { id: clientId },
    data: { status: "ACTIVE", deletedAt: null },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client.restore",
    entityType: "Client",
    entityId: clientId,
    clientId,
  });
  return client;
}

/// Portal phase 2: who may be named as a client's account manager.
///
/// Every Ankora user who is not a client user, ordered by name. No
/// permission check of its own: the only caller is the client screen,
/// which is already gated on client.manage, and what this returns
/// (colleagues' names) is not a disclosure to anyone who can reach it.
export async function listStaffForAssignment(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { deletedAt: null, status: "ACTIVE", role: { not: "CLIENT_USER" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
