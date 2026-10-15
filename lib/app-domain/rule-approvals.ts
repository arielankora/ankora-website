import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import type { User } from "@prisma/client";

// Org brain, phase 3: who approves exceptions to a client's rules and
// sensitive information for its file (claude/org-brain-spec-2026-10-12.md,
// decision 5; rules R6 and R7 to R10, R15).
//
// Two layers, the client's first:
// 1. **The client said who** (Client.ruleApproverIds): only those people,
//    for that client. NUX: sensitive information only with Ariel's prior
//    approval, until Oren says otherwise.
// 2. **Otherwise**, anyone given the permission on their user page
//    (User.canApproveExceptions): Ariel and Hadas.
//
// Asking for one's own exception and approving it is allowed (decision
// 5); the log records both, which is the control.

export const RULE_APPROVAL_LABEL = "אישור חריגות ומידע רגיש";

/// The people who may approve for this client, by name, for the screen
/// and the notices: only those who can reach the client at all.
export async function ruleApproversFor(clientId: string): Promise<{ id: string; name: string }[]> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { ruleApproverIds: true } });
  const named = client?.ruleApproverIds ?? [];
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      role: { not: "CLIENT_USER" },
      ...(named.length > 0 ? { id: { in: named } } : { canApproveExceptions: true }),
    },
    select: { id: true, name: true, role: true, clientAccess: { where: { clientId }, select: { id: true } } },
    orderBy: { name: "asc" },
  });
  return users.filter((u) => canManageClients(u.role) || u.clientAccess.length > 0).map(({ id, name }) => ({ id, name }));
}

export async function canApproveForClient(actor: User, clientId: string): Promise<boolean> {
  if (actor.role === "CLIENT_USER") return false;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { ruleApproverIds: true } });
  if (!client) return false;
  if (client.ruleApproverIds.length > 0) return client.ruleApproverIds.includes(actor.id);
  return actor.canApproveExceptions;
}

export async function assertCanApproveForClient(actor: User, clientId: string) {
  if (!(await canApproveForClient(actor, clientId))) {
    const names = (await ruleApproversFor(clientId)).map((u) => u.name);
    throw new Error(names.length ? `רק ${names.join(" או ")} מאשרים חריגות ומידע רגיש אצל הלקוח הזה.` : "אין עדיין מי שמאשר חריגות ומידע רגיש. נותנים את ההרשאה בדף המשתמש.");
  }
}

/// The client's own approvers. Empty clears them, and the permission
/// decides again. A manager sets them, from what the client said.
export async function setClientRuleApprovers(actor: User, clientId: string, userIds: string[]) {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל קובע מי מאשר אצל הלקוח.");
  await assertClientAccess(actor, clientId);
  const unique = [...new Set(userIds.filter(Boolean))];
  const found = await prisma.user.count({ where: { id: { in: unique }, deletedAt: null, role: { not: "CLIENT_USER" } } });
  if (found !== unique.length) throw new Error("אפשר לבחור רק אנשי צוות של אנקורה.");
  const before = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { ruleApproverIds: true } });
  await prisma.client.update({ where: { id: clientId }, data: { ruleApproverIds: unique } });
  await recordAudit({
    actorId: actor.id,
    action: "client.rule_approvers",
    entityType: "Client",
    entityId: clientId,
    clientId,
    before: { ruleApproverIds: before.ruleApproverIds },
    after: { ruleApproverIds: unique },
  });
}

/// The permission on a person (decision 5). Granted on the user page by
/// whoever manages users.
export async function setUserCanApproveExceptions(actor: User, userId: string, value: boolean) {
  assertCan(actor.role, "user.manage");
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { canApproveExceptions: true, role: true } });
  if (value && before.role === "CLIENT_USER") throw new Error("ההרשאה ניתנת רק לאנשי צוות של אנקורה.");
  await prisma.user.update({ where: { id: userId }, data: { canApproveExceptions: value } });
  await recordAudit({
    actorId: actor.id,
    action: "user.exception_approver",
    entityType: "User",
    entityId: userId,
    before: { canApproveExceptions: before.canApproveExceptions },
    after: { canApproveExceptions: value },
  });
}

/// One in-app notice to each approver of a client, except the person who
/// caused it. Returns how many were written.
export async function notifyRuleApprovers(clientId: string, exceptUserId: string, notice: { type: string; title: string; body: string; entityType: string }) {
  const approvers = (await ruleApproversFor(clientId)).filter((u) => u.id !== exceptUserId);
  if (approvers.length === 0) return 0;
  await prisma.notification.createMany({
    data: approvers.map((u) => ({ userId: u.id, type: notice.type, title: notice.title, body: notice.body, entityType: notice.entityType, entityId: clientId })),
  });
  return approvers.length;
}
