import "server-only";
import type { AuditEvent, KnowledgeProposal, KnowledgeStatus, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DomainError } from "@/lib/domain-error";
import { readSourceRefs } from "@/lib/knowledge-sources";
import { RESTORABLE_FACT_FIELDS, removeClientFact, restoreClientFact, undoFactSupersede, type RestorableFactFields } from "@/lib/app-domain/client-facts";
import { updateClientContact, updateClientOrganization } from "@/lib/app-domain/client-contacts";
import { updateSystemAccess } from "@/lib/app-domain/system-map";
import { updateRequestType } from "@/lib/app-domain/request-types";
import { updateClientEntity } from "@/lib/app-domain/client-entities";

// "ביטול" of an approved change (19.11.2026): a SUPERSEDE or a CONTRADICT
// that changed an item already in the file is taken back, so a change can
// one day enter on its own the way a new item does (approval tiers). The
// pure rule of what may be taken back is revertBlocker
// (lib/knowledge-proposals.ts); this module reads what the item was.
//
// What it was is the audit row the approval wrote on the item, a moment
// before its own row on the proposal: a fact's replacement keeps the old
// version, so only its status is read back; any other item was changed in
// place, and the row's `before` holds the fields as they were. They are
// written back through the item's own update function, so every check it
// makes runs and it writes its own audit row. Sources the change added go
// with it: the sources are written back as they were.
//
// Refused, in Hebrew, when it cannot be done right: the item changed after
// the approval (any later audit row on it, or fields that are no longer
// what the approval left), the row is missing, or the change wrote a field
// that cannot be written back.

type ItemTarget = "CONTACT" | "ORGANIZATION" | "SYSTEM" | "REQUEST_TYPE" | "ENTITY";

const ENTITY_TYPE: Record<ItemTarget | "FACT", string> = {
  FACT: "ClientFact",
  CONTACT: "ClientContact",
  ORGANIZATION: "ClientOrganization",
  SYSTEM: "SystemAccess",
  REQUEST_TYPE: "RequestType",
  ENTITY: "ClientEntity",
};

const UPDATE_ACTION: Record<ItemTarget, string> = {
  CONTACT: "client_contact.update",
  ORGANIZATION: "client_organization.update",
  SYSTEM: "system_access.update",
  REQUEST_TYPE: "request_type.update",
  ENTITY: "client_entity.update",
};

/// The knowledge fields (lib/app-domain/knowledge-items.ts): each update
/// function takes them by these names.
const KNOWLEDGE_FIELDS = ["knowledgeStatus", "toResolve", "importance", "audience", "audienceUserIds", "doNotDisclose", "sensitivity", "externalRefs", "sources", "clientVisible", "ownerId"];

/// The fields each update function writes back by the name the row keeps
/// them under. A contact's name, emails and phones are its person's; an
/// organization's domains are its organization's. An entity's
/// "missing" marks are written from another input, so not here.
const RESTORABLE: Record<ItemTarget, readonly string[]> = {
  CONTACT: [...KNOWLEDGE_FIELDS, "fieldStatus", "role", "relationship", "entityId", "context", "channelOrder", "isPrimary", "isDecisionMaker", "clientSideAddress", "endedAt", "userId", "name", "emails", "phones"],
  ORGANIZATION: [...KNOWLEDGE_FIELDS, "fieldStatus", "role", "relationship", "monthlyCostMinor", "currency", "notes", "domains"],
  SYSTEM: [...KNOWLEDGE_FIELDS, "fieldStatus", "systemName", "purpose", "entityId", "url", "accountUsed", "ourPermission", "accessStatus", "blocker", "clientAdmin", "credentialId", "billingCycle", "billingCostMinor", "billingCurrency", "cardLast4", "invoiceTo", "notes"],
  REQUEST_TYPE: [...KNOWLEDGE_FIELDS, "fieldStatus", "title", "fromWho", "arrivesVia", "handling", "routeToContactIds", "entityId", "processId"],
  ENTITY: [...KNOWLEDGE_FIELDS, "name", "legalName", "registrationNumber", "country", "currency", "billingAddress", "parentId"],
};

/// The row's own bookkeeping: never a field a proposal wrote.
const BOOKKEEPING = new Set(["id", "clientId", "personId", "organizationId", "createdById", "createdAt", "updatedAt", "deletedAt", "verifiedAt", "person", "organization"]);

/// What "ביטול" will do, read and checked before the proposal is marked.
export type UndoPlan = { restored: string[]; run: (actor: User) => Promise<unknown> };

const json = (v: unknown) => JSON.stringify(v === undefined ? null : JSON.parse(JSON.stringify(v)));

function changedSince(): DomainError {
  return new DomainError("knowledgeProposals.changedSince", "הפריט השתנה אחרי האישור, אז הביטול לא מחזיר אותו למה שהיה: זה היה דורס את מה שנעשה בו אחר כך. מתקנים אותו ביד בתיק.");
}

function noSnapshot(): DomainError {
  return new DomainError("knowledgeProposals.noSnapshot", "לא נשמר בתיעוד מה היה בפריט לפני האישור, אז אין למה להחזיר אותו. מתקנים אותו ביד בתיק.");
}

/// The audit row the approval wrote on the item: the last row of these
/// actions on it, by the person who approved, up to the proposal's own
/// approval row (a minute at most before it). Null when there is none.
async function approvalRow(proposalId: string, entityType: string, entityId: string, actions: string[]): Promise<AuditEvent | null> {
  const anchor = await prisma.auditEvent.findFirst({
    where: { entityType: "KnowledgeProposal", entityId: proposalId, action: { in: ["knowledge_proposal.approve", "knowledge_proposal.auto_apply"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!anchor) return null;
  return prisma.auditEvent.findFirst({
    where: { entityType, entityId, action: { in: actions }, actorId: anchor.actorId, createdAt: { lte: anchor.createdAt, gte: new Date(anchor.createdAt.getTime() - 60_000) } },
    orderBy: { createdAt: "desc" },
  });
}

/// Refused when anything wrote on these items after the approval's row.
async function assertNothingSince(row: AuditEvent, entityIds: string[]) {
  const later = await prisma.auditEvent.count({ where: { entityType: row.entityType, entityId: { in: entityIds }, createdAt: { gt: row.createdAt }, id: { not: row.id } } });
  if (later > 0) throw changedSince();
}

/// An item's row as plain fields: a contact's person's name, emails and
/// phones and an organization's domains read as its own; bookkeeping left
/// out (`keep` keeps some of it).
function flat(row: unknown, keep: readonly string[] = []): Record<string, unknown> | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (k === "person" && v && typeof v === "object") {
      const person = v as Record<string, unknown>;
      for (const f of ["name", "emails", "phones"]) if (f in person) out[f] = person[f];
      continue;
    }
    if (k === "organization" && v && typeof v === "object") {
      const org = v as Record<string, unknown>;
      if ("domains" in org) out.domains = org.domains;
      continue;
    }
    if (BOOKKEEPING.has(k) && !keep.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/// The fields that differ between the row before and after the approval.
/// Only fields both sides carry: one stored on one side only says nothing.
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(before).filter((k) => k in after && json(before[k]) !== json(after[k]));
}

/// Refused when the item is not what the approval left any more, even
/// with no audit row to say so (a person shared with another client).
function assertAsLeft(current: Record<string, unknown> | null, after: Record<string, unknown>, keys: string[]) {
  if (!current) throw changedSince();
  if (keys.some((k) => json(current[k]) !== json(after[k]))) throw changedSince();
}

function assertRestorable(keys: string[], allowed: readonly string[]) {
  const not = keys.filter((k) => !allowed.includes(k));
  if (not.length) throw new DomainError("knowledgeProposals.fieldsNotRestorable", `ההצעה שינתה שדות שהביטול לא יודע להחזיר (${not.join(", ")}). מתקנים אותם ביד בתיק.`, { fields: not.join(", ") });
}

async function currentRow(target: ItemTarget, id: string): Promise<unknown> {
  const where = { id, deletedAt: null };
  if (target === "CONTACT") return prisma.clientContact.findFirst({ where, include: { person: true } });
  if (target === "ORGANIZATION") return prisma.clientOrganization.findFirst({ where, include: { organization: true } });
  if (target === "SYSTEM") return prisma.systemAccess.findFirst({ where });
  if (target === "REQUEST_TYPE") return prisma.requestType.findFirst({ where });
  return prisma.clientEntity.findFirst({ where });
}

/// The update input that puts these fields back, by the names the update
/// functions take. A contact's end day is "YYYY-MM-DD" there.
function restoreInput(target: ItemTarget, before: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const k of keys) input[k] = before[k];
  if (target === "CONTACT" && "endedAt" in input) input.endedAt = typeof input.endedAt === "string" ? input.endedAt.slice(0, 10) : null;
  // What we knew and from where go back together, and a status that was
  // confirmed stays so: it was, before this change, on these sources.
  if (keys.some((k) => k === "knowledgeStatus" || k === "toResolve" || k === "sources")) {
    input.knowledgeStatus = before.knowledgeStatus;
    input.toResolve = before.toResolve ?? null;
    input.sources = readSourceRefs(before.sources);
    if (before.knowledgeStatus === "CONFIRMED") input.manualConfirm = true;
  }
  return input;
}

async function runUpdate(actor: User, target: ItemTarget, id: string, input: Record<string, unknown>) {
  if (target === "CONTACT") return updateClientContact(actor, id, input as Parameters<typeof updateClientContact>[2]);
  if (target === "ORGANIZATION") return updateClientOrganization(actor, id, input as Parameters<typeof updateClientOrganization>[2]);
  if (target === "SYSTEM") return updateSystemAccess(actor, id, input as Parameters<typeof updateSystemAccess>[2]);
  if (target === "REQUEST_TYPE") return updateRequestType(actor, id, input as Parameters<typeof updateRequestType>[2]);
  return updateClientEntity(actor, id, input as Parameters<typeof updateClientEntity>[2]);
}

const FACT_DATES = new Set(["answeredAt", "verifiedAt"]);

/// What taking back this approved change will do, or a refusal in its own
/// words. Only for what revertBlocker already allows.
export async function planUndo(p: Pick<KnowledgeProposal, "id" | "target" | "action" | "targetId" | "resultId">): Promise<UndoPlan> {
  const targetId = p.targetId;
  const resultId = p.resultId;
  if (!targetId || !resultId) throw noSnapshot();

  if (p.target === "FACT") {
    // A contradiction, or an open question answered: changed in place.
    if (p.action === "CONTRADICT" || resultId === targetId) {
      const row = await approvalRow(p.id, ENTITY_TYPE.FACT, targetId, ["client_fact.contradict", "client_fact.answer"]);
      const before = flat(row?.beforeJson, ["verifiedAt"]);
      const after = flat(row?.afterJson, ["verifiedAt"]);
      if (!row || !before || !after) throw noSnapshot();
      await assertNothingSince(row, [targetId]);
      const keys = changedKeys(before, after);
      assertRestorable(keys, RESTORABLE_FACT_FIELDS);
      const now = await prisma.clientFact.findFirst({ where: { id: targetId, deletedAt: null } });
      assertAsLeft(flat(now, ["verifiedAt"]), after, keys);
      const values: Record<string, unknown> = {};
      for (const k of keys) values[k] = FACT_DATES.has(k) && typeof before[k] === "string" ? new Date(before[k] as string) : before[k];
      return { restored: keys, run: (actor) => restoreClientFact(actor, targetId, values as RestorableFactFields) };
    }
    const old = await prisma.clientFact.findUnique({ where: { id: targetId }, select: { supersededById: true } });
    if (old?.supersededById === resultId) {
      // A new version beside the old: the new one leaves, the old one is
      // current again with the status it had.
      const row = await approvalRow(p.id, ENTITY_TYPE.FACT, targetId, ["client_fact.supersede"]);
      const status = (row?.beforeJson as { knowledgeStatus?: string } | null)?.knowledgeStatus;
      if (!row || !status || status === "SUPERSEDED") throw noSnapshot();
      await assertNothingSince(row, [targetId, resultId]);
      return { restored: ["knowledgeStatus", "supersededById", "supersededAt"], run: (actor) => undoFactSupersede(actor, targetId, status as KnowledgeStatus) };
    }
    // A version of another kind entered as an item of its own
    // (knowledge-proposals.ts, apply): it only leaves again.
    const row = await approvalRow(p.id, ENTITY_TYPE.FACT, resultId, ["client_fact.add"]);
    if (!row) throw noSnapshot();
    await assertNothingSince(row, [resultId]);
    return { restored: [], run: (actor) => removeClientFact(actor, resultId) };
  }

  const target = p.target as ItemTarget;
  if (!(target in UPDATE_ACTION)) throw noSnapshot();
  const row = await approvalRow(p.id, ENTITY_TYPE[target], targetId, [UPDATE_ACTION[target]]);
  const before = flat(row?.beforeJson);
  const after = flat(row?.afterJson);
  if (!row || !before || !after) throw noSnapshot();
  await assertNothingSince(row, [targetId]);
  const keys = changedKeys(before, after);
  assertRestorable(keys, RESTORABLE[target]);
  assertAsLeft(flat(await currentRow(target, targetId)), after, keys);
  const input = restoreInput(target, before, keys);
  return { restored: keys, run: async (actor) => (keys.length ? runUpdate(actor, target, targetId, input) : null) };
}
