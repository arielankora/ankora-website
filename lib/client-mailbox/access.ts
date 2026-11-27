import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { DomainError } from "@/lib/domain-error";

// Who may use which mailbox through the connector (27.11.2026, Ariel,
// https://claude.ai/artifact/5GT2bZeiXvbMCfCYBoe4Pg):
//
// - A client's mailbox: the system admins, the client's account manager and
//   its backup manager always may, read and send, by their role. When the
//   account manager changes, access moves with the role. Anyone else only
//   when they are on the mailbox's list (MailboxAccess), read only or read
//   and send. Seeing the client's file is not enough.
// - An employee's own mailbox ("התיבות שלי"): only its owner, not even a
//   system admin.
//
// The list is edited by the admins, the account manager and the backup
// manager, on the client's connections screen.

export type AccessReason = "admin" | "accountManager" | "backupManager" | "list" | "owner";
export type MailboxAccessLevel = { reason: AccessReason; canSend: boolean };

type Actor = Pick<User, "id" | "role">;
type ClientRoles = { accountManagerId: string | null; backupManagerId: string | null };

/// The access a person has to every client mailbox by their role alone.
export function roleAccess(actor: Actor, client: ClientRoles): MailboxAccessLevel | null {
  if (canManageClients(actor.role)) return { reason: "admin", canSend: true };
  if (client.accountManagerId === actor.id) return { reason: "accountManager", canSend: true };
  if (client.backupManagerId === actor.id) return { reason: "backupManager", canSend: true };
  return null;
}

/// Whether this person edits the list of a client's mailboxes.
export function mayEditMailboxAccess(actor: Actor, client: ClientRoles): boolean {
  return roleAccess(actor, client) !== null;
}

/// The access a person has to these client mailboxes (connection ids), by
/// role or by the list. A mailbox missing from the answer is closed to them.
export async function clientMailboxAccess(actor: Actor, client: ClientRoles, connectionIds: string[]): Promise<Map<string, MailboxAccessLevel>> {
  const out = new Map<string, MailboxAccessLevel>();
  const byRole = roleAccess(actor, client);
  if (byRole) {
    for (const id of connectionIds) out.set(id, byRole);
    return out;
  }
  if (connectionIds.length === 0) return out;
  const rows = await prisma.mailboxAccess.findMany({ where: { userId: actor.id, connectionId: { in: connectionIds } }, select: { connectionId: true, canSend: true } });
  for (const r of rows) out.set(r.connectionId, { reason: "list", canSend: r.canSend });
  return out;
}

// ---------------------------------------------------------------- the list, on the connections screen

export type MailboxAccessView = {
  /// The people who reach the mailbox by role, named.
  byRole: { name: string; reason: "accountManager" | "backupManager" }[];
  list: { id: string; userId: string; name: string; canSend: boolean }[];
  /// People who see the client and are not on the list yet.
  candidates: { userId: string; name: string }[];
};

async function clientRolesOf(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, accountManagerId: true, backupManagerId: true } });
  if (!client) throw new DomainError("connections.mailboxAccess.notFound", "התיבה לא נמצאה.");
  return client;
}

function assertMayEdit(actor: Actor, client: ClientRoles) {
  if (!mayEditMailboxAccess(actor, client)) {
    throw new DomainError("connections.mailboxAccess.notAllowed", "את רשימת הגישה לתיבה משנים מנהלי המערכת, מנהל התיק והמחליף שלו.");
  }
}

/// Each Unipile mailbox of the client: who reaches it and who may be added.
export async function mailboxAccessViews(clientId: string): Promise<Record<string, MailboxAccessView>> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      accountManagerId: true,
      backupManagerId: true,
      accountManager: { select: { name: true } },
      backupManager: { select: { name: true } },
    },
  });
  if (!client) return {};
  const conns = await prisma.clientConnection.findMany({
    where: { clientId, kind: "UNIPILE_MAIL", revokedAt: null },
    select: { id: true, access: { select: { id: true, userId: true, canSend: true, user: { select: { name: true } } }, orderBy: { grantedAt: "asc" } } },
  });
  if (conns.length === 0) return {};
  const byRole: MailboxAccessView["byRole"] = [];
  if (client.accountManager) byRole.push({ name: client.accountManager.name, reason: "accountManager" });
  if (client.backupManager && client.backupManagerId !== client.accountManagerId) byRole.push({ name: client.backupManager.name, reason: "backupManager" });
  const seeing = await prisma.userClientAccess.findMany({
    where: { clientId, user: { status: "ACTIVE", role: "ANKORA_EMPLOYEE" } },
    select: { userId: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const roleIds = new Set([client.accountManagerId, client.backupManagerId].filter(Boolean));
  const out: Record<string, MailboxAccessView> = {};
  for (const c of conns) {
    const listed = new Set(c.access.map((a) => a.userId));
    out[c.id] = {
      byRole,
      list: c.access.map((a) => ({ id: a.id, userId: a.userId, name: a.user.name, canSend: a.canSend })),
      candidates: seeing.filter((s) => !listed.has(s.userId) && !roleIds.has(s.userId)).map((s) => ({ userId: s.userId, name: s.user.name })),
    };
  }
  return out;
}

async function connectionOf(connectionId: string) {
  const conn = await prisma.clientConnection.findUnique({ where: { id: connectionId }, select: { id: true, clientId: true, kind: true, account: true, revokedAt: true } });
  if (!conn || conn.kind !== "UNIPILE_MAIL" || conn.revokedAt) throw new DomainError("connections.mailboxAccess.notFound", "התיבה לא נמצאה.");
  return conn;
}

/// Adds a person to a client mailbox's list. They must see the client.
export async function grantMailboxAccess(actor: Actor, input: { connectionId: string; userId: string; canSend: boolean }) {
  const conn = await connectionOf(input.connectionId);
  const client = await clientRolesOf(conn.clientId);
  assertMayEdit(actor, client);
  const sees = await prisma.userClientAccess.count({ where: { clientId: conn.clientId, userId: input.userId, user: { status: "ACTIVE" } } });
  if (!sees) throw new DomainError("connections.mailboxAccess.notOnClient", "אפשר להוסיף לתיבה רק מי שיש לו גישה ללקוח באנקורה.");
  const row = await prisma.mailboxAccess.upsert({
    where: { connectionId_userId: { connectionId: conn.id, userId: input.userId } },
    create: { connectionId: conn.id, userId: input.userId, canSend: input.canSend, grantedById: actor.id },
    update: { canSend: input.canSend, grantedById: actor.id },
  });
  await recordAudit({ actorId: actor.id, action: "connection.mailbox_access_grant", entityType: "ClientConnection", entityId: conn.id, clientId: conn.clientId, after: { userId: input.userId, canSend: input.canSend, account: conn.account } });
  return row;
}

/// Changes a listed person's level, or takes them off the list.
export async function changeMailboxAccess(actor: Actor, input: { accessId: string; canSend?: boolean; remove?: boolean }) {
  const row = await prisma.mailboxAccess.findUnique({ where: { id: input.accessId }, include: { connection: { select: { id: true, clientId: true, account: true } } } });
  if (!row) throw new DomainError("connections.mailboxAccess.notFound", "התיבה לא נמצאה.");
  const client = await clientRolesOf(row.connection.clientId);
  assertMayEdit(actor, client);
  if (input.remove) {
    await prisma.mailboxAccess.delete({ where: { id: row.id } });
  } else if (typeof input.canSend === "boolean") {
    await prisma.mailboxAccess.update({ where: { id: row.id }, data: { canSend: input.canSend, grantedById: actor.id } });
  }
  await recordAudit({
    actorId: actor.id,
    action: input.remove ? "connection.mailbox_access_revoke" : "connection.mailbox_access_change",
    entityType: "ClientConnection",
    entityId: row.connection.id,
    clientId: row.connection.clientId,
    before: { userId: row.userId, canSend: row.canSend },
    after: input.remove ? null : { userId: row.userId, canSend: input.canSend ?? row.canSend },
  });
}

// ---------------------------------------------------------------- the day the list starts

export type AccessLossRow = { client: string; mailbox: string; keepByRole: string[]; onList: string[]; loses: string[] };

/// For each connected client mailbox: who keeps it by role, who is on its
/// list, and who saw it until now (by seeing the client) and will not.
/// Read only; scripts/mailbox-access-report.ts prints it.
export async function accessLossReport(): Promise<AccessLossRow[]> {
  const conns = await prisma.clientConnection.findMany({
    where: { kind: "UNIPILE_MAIL", revokedAt: null },
    select: {
      account: true,
      access: { select: { userId: true, user: { select: { name: true } } } },
      client: {
        select: {
          name: true,
          accountManagerId: true,
          backupManagerId: true,
          accountManager: { select: { name: true } },
          backupManager: { select: { name: true } },
          employeeAccess: { where: { user: { status: "ACTIVE" } }, select: { userId: true, user: { select: { name: true, role: true } } } },
        },
      },
    },
    orderBy: [{ client: { name: "asc" } }, { account: "asc" }],
  });
  return conns.map((c) => {
    const keep = new Set([c.client.accountManagerId, c.client.backupManagerId].filter(Boolean) as string[]);
    const listed = new Set(c.access.map((a) => a.userId));
    return {
      client: c.client.name,
      mailbox: c.account,
      keepByRole: [c.client.accountManager?.name, c.client.backupManager?.name].filter(Boolean) as string[],
      onList: c.access.map((a) => a.user.name),
      loses: c.client.employeeAccess.filter((u) => !canManageClients(u.user.role) && !keep.has(u.userId) && !listed.has(u.userId)).map((u) => u.user.name),
    };
  });
}
