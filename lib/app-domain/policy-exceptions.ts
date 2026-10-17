import "server-only";
import { rescanAfterRuleChange } from "@/lib/app-domain/process-review";
import { ruleChangeCause } from "@/lib/process-review";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { assertCanApproveForClient, notifyRuleApprovers } from "@/lib/app-domain/rule-approvals";
import { findSecrets } from "@/lib/secret-scan";
import { exceptionShapeError, isExceptionInForce, EXCEPTION_MAX_DAYS } from "@/lib/client-policies";
import type { User } from "@prisma/client";

// Org brain, phase 3: exceptions to a client's rules
// (claude/org-brain-spec-2026-10-12.md, 3.11 PolicyException, 7.2).
//
// An exception is how a rule is broken on purpose and on the record:
// what is done differently, why, until when, who asked and who approved.
// It always ends (at most EXCEPTION_MAX_DAYS): one with no end is a rule
// change, and goes through the rule. Until processes exist nothing checks
// a step against a rule, so today an exception is the written permission
// a person shows, and the file carries it next to its rule.

export const EXCEPTION_REQUESTED = "policy_exception.requested";
export const EXCEPTION_DECIDED = "policy_exception.decided";

export type ExceptionInput = { policyId: string; what: string; reason: string; validUntil: Date };

async function findException(actor: User, id: string) {
  const row = await prisma.policyException.findUnique({ where: { id }, include: { policy: { select: { title: true, clientId: true, audience: true } } } });
  if (!row) throw new Error("הבקשה לא נמצאה.");
  await assertClientAccess(actor, row.clientId);
  return row;
}

export async function requestException(actor: User, input: ExceptionInput, now = new Date()) {
  assertCan(actor.role, "time_entry.create_self");
  const policy = await prisma.clientPolicy.findUnique({ where: { id: input.policyId } });
  if (!policy || policy.deletedAt) throw new Error("הכלל לא נמצא.");
  await assertClientAccess(actor, policy.clientId);
  if (policy.status === "RETIRED") throw new Error("הכלל בוטל, ואין ממנו חריגה.");
  const shapeError = exceptionShapeError(input, now);
  if (shapeError) throw new Error(shapeError);
  if (findSecrets(`${input.what}\n${input.reason}`).length > 0) throw new Error("בבקשה יש סיסמה, מפתח או מספר כרטיס. סודות נשמרים בכספת.");

  const row = await prisma.policyException.create({
    data: {
      clientId: policy.clientId,
      policyId: policy.id,
      what: input.what.trim(),
      reason: input.reason.trim(),
      validUntil: input.validUntil,
      requestedById: actor.id,
    },
  });
  await recordAudit({ actorId: actor.id, action: "policy_exception.request", entityType: "PolicyException", entityId: row.id, clientId: policy.clientId, after: row });
  const client = await prisma.client.findUniqueOrThrow({ where: { id: policy.clientId }, select: { name: true } });
  await notifyRuleApprovers(policy.clientId, actor.id, {
    type: EXCEPTION_REQUESTED,
    title: `${client.name}: בקשה לחריגה מהכלל "${policy.title}"`.slice(0, 200),
    body: `${actor.name} מבקש/ת: ${row.what}`.slice(0, 500),
    entityType: "ClientRules",
  });
  return row;
}

async function decide(actor: User, id: string, approve: boolean, note: string | null) {
  assertCan(actor.role, "time_entry.create_self");
  const before = await findException(actor, id);
  if (before.status !== "REQUESTED") throw new Error("כבר הוחלט על הבקשה הזו.");
  await assertCanApproveForClient(actor, before.clientId);
  const why = note?.trim() || null;
  if (!approve && !why) throw new Error("צריך לכתוב בשורה אחת למה הבקשה נדחתה.");
  const updated = await prisma.policyException.update({
    where: { id },
    data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionNote: why },
  });
  await recordAudit({
    actorId: actor.id,
    action: approve ? "policy_exception.approve" : "policy_exception.reject",
    entityType: "PolicyException",
    entityId: id,
    clientId: before.clientId,
    before,
    after: updated,
  });
  if (before.requestedById !== actor.id) {
    await prisma.notification.create({
      data: {
        userId: before.requestedById,
        type: EXCEPTION_DECIDED,
        title: `${approve ? "אושרה" : "נדחתה"} חריגה מהכלל "${before.policy.title}"`.slice(0, 200),
        body: (why ? `${before.what}. ${why}` : before.what).slice(0, 500),
        entityType: "ClientRules",
        entityId: before.clientId,
      },
    });
  }
  if (approve) await rescanAfterRuleChange(before.clientId, ruleChangeCause(before.policy, "אושרה חריגה לכלל"));
  return updated;
}

export const approveException = (actor: User, id: string, note?: string | null) => decide(actor, id, true, note ?? null);
export const rejectException = (actor: User, id: string, note: string) => decide(actor, id, false, note);

export async function withdrawException(actor: User, id: string) {
  const before = await findException(actor, id);
  if (before.status !== "REQUESTED") throw new Error("אפשר למשוך רק בקשה שעוד לא הוחלט עליה.");
  if (before.requestedById !== actor.id) throw new Error("רק מי שביקש מושך את הבקשה.");
  const updated = await prisma.policyException.update({ where: { id }, data: { status: "WITHDRAWN" } });
  await recordAudit({ actorId: actor.id, action: "policy_exception.withdraw", entityType: "PolicyException", entityId: id, clientId: before.clientId, before, after: updated });
  return updated;
}

/// Requests waiting and exceptions in force, for one client, with names.
/// Ended, refused and withdrawn ones stay in the log, not on the screen.
export async function listOpenExceptions(actor: User, clientId: string, now = new Date()) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const rows = await prisma.policyException.findMany({
    where: { clientId, status: { in: ["REQUESTED", "APPROVED"] } },
    orderBy: { createdAt: "asc" },
  });
  const live = rows.filter((r) => r.status === "REQUESTED" || isExceptionInForce(r, now));
  const ids = [...new Set(live.flatMap((r) => [r.requestedById, r.decidedById]).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return live.map((r) => ({
    ...r,
    requestedByName: nameOf.get(r.requestedById) ?? null,
    decidedByName: r.decidedById ? nameOf.get(r.decidedById) ?? null : null,
  }));
}

export { EXCEPTION_MAX_DAYS };
