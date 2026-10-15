import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSeeKnowledgeItem } from "@/lib/knowledge";
import { changesSubstance, policyShapeError, type PolicyKindLike } from "@/lib/client-policies";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { assertResolvable, knowledgeData, sourcedFields, type KnowledgeInput } from "@/lib/app-domain/knowledge-items";
import type { ClientPolicy, PolicyKind, User } from "@prisma/client";

// Org brain, phase 3: the client's own rules
// (claude/org-brain-spec-2026-10-12.md, 3.11; section 6 of the file).
//
// A rule is knowledge like any other item in the file: it has a source
// and a status, and anyone assigned to the client may write it down. What
// sets it apart is that it binds, so two things are decided here:
//
// 1. **Only a manager makes a rule "in force"** (approve) or ends it
//    (retire). Until then it is "proposed", and what applies is its
//    interim rule, or the rule as written when it restricts.
// 2. **A rule cannot be softened quietly.** Changing what an approved rule
//    says sends it back to "proposed" with a new version number, and the
//    audit log keeps both texts. Its interim rule, or the new text,
//    applies until a manager approves again.

export interface ClientPolicyInput extends KnowledgeInput {
  clientId: string;
  kind: PolicyKind;
  title: string;
  statement: string;
  rationale?: string | null;
  interimStatement?: string | null;
}

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

function assertManager(actor: User) {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל מאשר או מבטל כלל של לקוח.");
}

async function findPolicy(actor: User, id: string) {
  const row = await prisma.clientPolicy.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw new Error("הכלל לא נמצא.");
  await assertClientAccess(actor, row.clientId);
  return row;
}

export async function addClientPolicy(actor: User, input: ClientPolicyInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  const shapeError = policyShapeError({ ...input, status: "PROPOSED" });
  if (shapeError) throw new Error(shapeError);
  assertResolvable(input.knowledgeStatus, input.toResolve);
  const sourced = await sourcedFields(input.clientId, input, [input.statement, input.rationale, input.interimStatement]);
  const row = await prisma.clientPolicy.create({
    data: {
      clientId: input.clientId,
      kind: input.kind,
      status: "PROPOSED",
      title: input.title.trim(),
      statement: input.statement.trim(),
      rationale: clean(input.rationale),
      interimStatement: clean(input.interimStatement),
      createdById: actor.id,
      ...knowledgeData(input),
      ...sourced,
    },
  });
  await recordAudit({ actorId: actor.id, action: "client_policy.add", entityType: "ClientPolicy", entityId: row.id, clientId: input.clientId, after: row });
  return row;
}

export async function updateClientPolicy(actor: User, id: string, input: Partial<Omit<ClientPolicyInput, "clientId">>) {
  assertCan(actor.role, "time_entry.create_self");
  const before = await findPolicy(actor, id);
  if (before.status === "RETIRED") throw new Error("כלל שבוטל לא נערך. כותבים כלל חדש.");
  const substantive = changesSubstance(before, {
    kind: input.kind,
    title: input.title,
    statement: input.statement,
    interimStatement: input.interimStatement !== undefined ? clean(input.interimStatement) : undefined,
  });
  const next = {
    kind: (input.kind ?? before.kind) as PolicyKindLike,
    status: substantive ? ("PROPOSED" as const) : before.status,
    title: input.title !== undefined ? input.title : before.title,
    statement: input.statement !== undefined ? input.statement : before.statement,
    interimStatement: input.interimStatement !== undefined ? clean(input.interimStatement) : before.interimStatement,
  };
  const shapeError = policyShapeError(next);
  if (shapeError) throw new Error(shapeError);
  assertResolvable(input.knowledgeStatus ?? before.knowledgeStatus, input.toResolve !== undefined ? input.toResolve : before.toResolve);
  const sourced = await sourcedFields(before.clientId, input, [next.statement, input.rationale ?? before.rationale, next.interimStatement], before);
  const updated = await prisma.clientPolicy.update({
    where: { id },
    data: {
      kind: input.kind ?? undefined,
      title: input.title !== undefined ? input.title.trim() : undefined,
      statement: input.statement !== undefined ? input.statement.trim() : undefined,
      rationale: input.rationale !== undefined ? clean(input.rationale) : undefined,
      interimStatement: input.interimStatement !== undefined ? clean(input.interimStatement) : undefined,
      // What it says changed: a new version, and back to a manager.
      ...(substantive
        ? { version: before.version + 1, status: "PROPOSED" as const, approvedById: null, approvedAt: null }
        : {}),
      ...knowledgeData(input),
      ...sourced,
    },
  });
  const reopened = substantive && before.status === "ACTIVE";
  await recordAudit({
    actorId: actor.id,
    action: reopened ? "client_policy.reopen" : "client_policy.update",
    entityType: "ClientPolicy",
    entityId: id,
    clientId: before.clientId,
    before,
    after: updated,
  });
  return updated;
}

export async function approveClientPolicy(actor: User, id: string) {
  assertManager(actor);
  const before = await findPolicy(actor, id);
  if (before.status !== "PROPOSED") throw new Error("רק כלל מוצע מאשרים.");
  if (before.knowledgeStatus !== "CONFIRMED") {
    throw new Error("הכלל עצמו עוד לא ודאי. קודם מוודאים מול הלקוח מה הוא אמר, ורק אז מאשרים.");
  }
  const updated = await prisma.clientPolicy.update({
    where: { id },
    data: { status: "ACTIVE", approvedById: actor.id, approvedAt: new Date() },
  });
  await recordAudit({ actorId: actor.id, action: "client_policy.approve", entityType: "ClientPolicy", entityId: id, clientId: before.clientId, before, after: updated });
  return updated;
}

export async function retireClientPolicy(actor: User, id: string, reason: string) {
  assertManager(actor);
  const before = await findPolicy(actor, id);
  if (before.status === "RETIRED") throw new Error("הכלל כבר בוטל.");
  const why = reason.trim();
  if (!why) throw new Error("צריך לכתוב בשורה אחת למה הכלל מבוטל.");
  const updated = await prisma.clientPolicy.update({
    where: { id },
    data: { status: "RETIRED", retiredAt: new Date(), retiredById: actor.id },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client_policy.retire",
    entityType: "ClientPolicy",
    entityId: id,
    clientId: before.clientId,
    before,
    after: { ...updated, reason: why.slice(0, 500) },
  });
  return updated;
}

/// A rule written by mistake. Only while proposed: an approved rule is
/// retired, so its history stays.
export async function removeClientPolicy(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const row = await findPolicy(actor, id);
  if (row.status !== "PROPOSED") throw new Error("כלל שאושר לא נמחק. מבטלים אותו, והוא נשאר בהיסטוריה.");
  const removed = await prisma.clientPolicy.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "client_policy.remove", entityType: "ClientPolicy", entityId: id, clientId: row.clientId, before: row });
  return removed;
}

const STATUS_ORDER = { ACTIVE: 0, PROPOSED: 1, RETIRED: 2 } as const;

/// In force first, then proposed, then retired; each kind together.
export async function listClientPolicies(actor: User, clientId: string): Promise<ClientPolicy[]> {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true } });
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const rows = await prisma.clientPolicy.findMany({ where: { clientId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  return rows
    .filter((r) => canSeeKnowledgeItem(r, viewer, client?.accountManagerId ?? null))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

/// The rules in force of some kinds, for several clients at once, as this
/// person may see them: what an unattended extraction run needs.
export async function policiesInForce(actor: User, clients: { id: string; accountManagerId: string | null }[], kinds: PolicyKind[]) {
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const managerOf = new Map(clients.map((c) => [c.id, c.accountManagerId]));
  const rows = await prisma.clientPolicy.findMany({
    where: { clientId: { in: clients.map((c) => c.id) }, deletedAt: null, status: { not: "RETIRED" }, kind: { in: kinds } },
    orderBy: { createdAt: "asc" },
  });
  return rows.filter((r) => canSeeKnowledgeItem(r, viewer, managerOf.get(r.clientId) ?? null));
}
