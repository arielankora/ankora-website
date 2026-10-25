import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import type { User, ClientStatus, ClientKind } from "@prisma/client";
import { ensureDefaultAlertRules } from "@/lib/app-domain/alerts";

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

/**
 * One client, with who is assigned to it.
 *
 * The columns of the assigned people are named, and that is the whole
 * point of this comment. `include: { user: true }` returned the User row
 * entire, `passwordHash` included, and `/app/clients/[clientId]` hands
 * this object to `<EditClientForm client={client} />`, which is a client
 * component. Next serialises a client component's props into the RSC
 * payload inside the page HTML, so every assigned employee's bcrypt hash
 * was sitting in the source of that screen, readable by anyone who may
 * open the client.
 *
 * TypeScript had nothing to say about it: the prop is declared `Client`,
 * and a variable, unlike an object literal, may carry properties its
 * declared type never mentions. That is word for word the mechanism of
 * #84, where three screens leaked the same column.
 *
 * Found on 25.10.2026 by the sweep merged in #326 that morning, on its
 * first level-3 run. The sweep had covered 41 screens and skipped every
 * route with an id in it, which is where records are rendered. This was
 * the first screen it looked at.
 *
 * Only `name` and `email` are rendered (the assigned-people list on the
 * client screen), so only those are asked for.
 */
export async function getClient(id: string) {
  return prisma.client.findFirst({
    where: { id, deletedAt: null },
    include: {
      employeeAccess: { include: { user: { select: { id: true, name: true, email: true } } } },
      categories: true,
    },
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
  // Watched from the first minute: see DEFAULT_ALERT_RULES.
  await ensureDefaultAlertRules(actor, client.id);
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
    /// Ankora's own work, kept out of the home-page hours chart. See
    /// Client.isInternal.
    isInternal?: boolean;
    /// Org brain (spec 3.3).
    kind?: ClientKind;
    industry?: string | null;
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

  // Archiving from the settings form is the same act as the archive
  // button on the client list (archiveClient): the client leaves the list,
  // the pickers and the portal together. Until 18.10.2026 the form set the
  // status alone, which left a client on the list whose screen could not
  // open (every panel reads through listAccessibleClients, active only) and
  // whose portal users kept their access (the portal checks deletedAt).
  const archiving = input.status === "ARCHIVED" && !before.deletedAt;

  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(archiving ? { deletedAt: new Date() } : {}),
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
      isInternal: input.isInternal,
      kind: input.kind,
      industry: input.industry === null ? null : input.industry?.trim() || undefined,
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
  if (archiving) {
    await recordAudit({
      actorId: actor.id,
      action: "client.archive",
      entityType: "Client",
      entityId: clientId,
      clientId,
    });
  }
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

/// The archived clients, for the list's "בארכיון" section: the only way
/// back to a client once the undo on the archive toast has gone.
export async function listArchivedClients(actor: User) {
  assertCan(actor.role, "client.manage");
  return prisma.client.findMany({
    where: { status: "ARCHIVED", deletedAt: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, deletedAt: true },
  });
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
