import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSeeKnowledgeItem } from "@/lib/knowledge";
import { changesSubstance, policyShapeError, policyVersions, type PolicyKindLike, type PolicyVersionView } from "@/lib/client-policies";
import { entityIdsIn, paramsError, paramsKey, readParams, type PolicyParams } from "@/lib/policy-params";
import { Prisma } from "@prisma/client";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { rescanAfterRuleChange } from "@/lib/app-domain/process-review";
import { ruleChangeCause } from "@/lib/process-review";
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
  /// What the server can check (lib/policy-params.ts). Read for the kind;
  /// keys the kind does not take are dropped.
  params?: unknown;
  interimParams?: unknown;
  /// Spec 3.11: the day it starts to bind, and the day it is looked at again.
  effectiveFrom?: Date | null;
  reviewBy?: Date | null;
}

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

function assertManager(actor: User) {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל מאשר או מבטל כלל של לקוח.");
}

/// The parameters as stored: read for the kind, complete, and pointing
/// only at this client's entities.
async function checkedParams(clientId: string, kind: PolicyKindLike, value: unknown, what: string): Promise<PolicyParams> {
  const p = readParams(kind, value);
  const error = paramsError(kind, p);
  if (error) throw new Error(what === "interim" ? `בכלל הביניים: ${error}` : error);
  const ids = entityIdsIn(p);
  if (ids.length) {
    const found = await prisma.clientEntity.count({ where: { id: { in: ids }, clientId, deletedAt: null } });
    if (found !== ids.length) throw new Error("ישות שנבחרה בכלל לא נמצאת בתיק של הלקוח.");
  }
  return p;
}

const json = (p: PolicyParams) => p as unknown as Prisma.InputJsonValue;

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
  const params = await checkedParams(input.clientId, input.kind as PolicyKindLike, input.params, "rule");
  const interimParams = await checkedParams(input.clientId, input.kind as PolicyKindLike, input.interimParams, "interim");
  const row = await prisma.clientPolicy.create({
    data: {
      clientId: input.clientId,
      kind: input.kind,
      status: "PROPOSED",
      title: input.title.trim(),
      statement: input.statement.trim(),
      rationale: clean(input.rationale),
      interimStatement: clean(input.interimStatement),
      params: json(params),
      interimParams: json(interimParams),
      effectiveFrom: input.effectiveFrom ?? null,
      reviewBy: input.reviewBy ?? null,
      createdById: actor.id,
      ...knowledgeData(input),
      ...sourced,
    },
  });
  await recordAudit({ actorId: actor.id, action: "client_policy.add", entityType: "ClientPolicy", entityId: row.id, clientId: input.clientId, after: row });
  await rescanAfterRuleChange(input.clientId, ruleChangeCause(row, "נוסף כלל"));
  return row;
}

export async function updateClientPolicy(actor: User, id: string, input: Partial<Omit<ClientPolicyInput, "clientId">>) {
  assertCan(actor.role, "time_entry.create_self");
  const before = await findPolicy(actor, id);
  if (before.status === "RETIRED") throw new Error("כלל שבוטל לא נערך. כותבים כלל חדש.");
  const kind = (input.kind ?? before.kind) as PolicyKindLike;
  // A change of kind rereads the stored parameters for the new kind.
  const params = await checkedParams(before.clientId, kind, input.params !== undefined ? input.params : before.params, "rule");
  const interimParams = await checkedParams(before.clientId, kind, input.interimParams !== undefined ? input.interimParams : before.interimParams, "interim");
  // What the server checks is part of what the rule says: raising a
  // threshold is softening it, and goes back to a manager like any edit.
  const substantive =
    changesSubstance(before, {
      kind: input.kind,
      title: input.title,
      statement: input.statement,
      interimStatement: input.interimStatement !== undefined ? clean(input.interimStatement) : undefined,
      effectiveFrom: input.effectiveFrom,
    }) ||
    paramsKey(params) !== paramsKey(readParams(before.kind as PolicyKindLike, before.params)) ||
    paramsKey(interimParams) !== paramsKey(readParams(before.kind as PolicyKindLike, before.interimParams));
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
      params: json(params),
      interimParams: json(interimParams),
      effectiveFrom: input.effectiveFrom !== undefined ? input.effectiveFrom : undefined,
      reviewBy: input.reviewBy !== undefined ? input.reviewBy : undefined,
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
  await rescanAfterRuleChange(before.clientId, ruleChangeCause(updated, reopened ? "כלל חזר להיות מוצע" : "כלל השתנה"));
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
  await rescanAfterRuleChange(before.clientId, ruleChangeCause(updated, "כלל אושר"));
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
  await rescanAfterRuleChange(before.clientId, ruleChangeCause(updated, "כלל בוטל"));
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
  await rescanAfterRuleChange(row.clientId, ruleChangeCause(row, "כלל הוסר"));
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

/// Spec 3.11: the earlier versions of the rules this person may see, by
/// rule. Only rules already read through listClientPolicies are asked for.
export async function policyHistory(actor: User, clientId: string, policies: { id: string; version: number }[]): Promise<Map<string, PolicyVersionView[]>> {
  await assertClientAccess(actor, clientId);
  const withPast = policies.filter((p) => p.version > 1);
  const out = new Map<string, PolicyVersionView[]>();
  if (!withPast.length) return out;
  const events = await prisma.auditEvent.findMany({
    where: { entityType: "ClientPolicy", entityId: { in: withPast.map((p) => p.id) }, clientId },
    select: { entityId: true, createdAt: true, beforeJson: true, afterJson: true },
    orderBy: { createdAt: "asc" },
  });
  for (const p of withPast) {
    const mine = events.filter((e) => e.entityId === p.id).map((e) => ({ createdAt: e.createdAt, before: e.beforeJson, after: e.afterJson }));
    const versions = policyVersions(mine, p.version);
    if (versions.length) out.set(p.id, versions);
  }
  return out;
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
