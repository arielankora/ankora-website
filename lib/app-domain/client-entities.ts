import "server-only";
import { syncDateCalendars } from "@/lib/app-domain/date-calendars";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSeeKnowledgeItem, type FieldStatusMap } from "@/lib/knowledge";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { assertResolvable, knowledgeData, sourcedFields, type KnowledgeInput } from "@/lib/app-domain/knowledge-items";
import type { User } from "@prisma/client";

// Org brain, phase 2: the client's legal entities
// (claude/org-brain-spec-2026-10-12.md, 3.3).
//
// NUX Inc and NUX.AI Ltd are one client and two entities, and most of the
// expensive mistakes in a client's money are an entity mix-up: Inc's
// invoice sent to Ltd's bookkeeper, Ltd's salary paid from Inc. So people
// and systems point at an entity, not at a word.
//
// An entity is usually known before all of its details are. Its fields
// can each be marked missing, and the entity reads as weak as its weakest
// field (lib/knowledge.ts, rule 1): "Ltd, registration number missing".

/// The fields that can be marked missing on their own.
export const ENTITY_FIELDS = ["legalName", "registrationNumber", "country", "currency", "billingAddress"] as const;
export type EntityField = (typeof ENTITY_FIELDS)[number];

export interface ClientEntityInput extends KnowledgeInput {
  clientId: string;
  name: string;
  legalName?: string | null;
  registrationNumber?: string | null;
  country?: string | null;
  currency?: string | null;
  billingAddress?: string | null;
  parentId?: string | null;
  /// Fields known to be needed and not received, and what would close them.
  missingFields?: EntityField[];
  missingToResolve?: string | null;
}

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

function code(v: string | null | undefined, length: number, label: string): string | null {
  const c = clean(v)?.toUpperCase() ?? null;
  if (c && !new RegExp(`^[A-Z]{${length}}$`).test(c)) throw new Error(`${label} לא תקין.`);
  return c;
}

/// A person or a system can only belong to an entity of the same client.
export async function assertEntityBelongs(clientId: string, entityId: string | null | undefined) {
  if (!entityId) return;
  const ok = await prisma.clientEntity.count({ where: { id: entityId, clientId, deletedAt: null } });
  if (!ok) throw new Error("הישות לא נמצאה אצל הלקוח.");
}

function fieldStatusFor(missing: EntityField[] | undefined, toResolve: string | null | undefined): FieldStatusMap | undefined {
  if (missing === undefined) return undefined;
  const why = clean(toResolve);
  if (missing.length > 0 && !why) throw new Error("לשדה חסר צריך לכתוב מה יסגור אותו.");
  const out: FieldStatusMap = {};
  for (const f of missing) {
    if (!(ENTITY_FIELDS as readonly string[]).includes(f)) continue;
    out[f] = { status: "MISSING", toResolve: why! };
  }
  return out;
}

function entityData(input: Partial<ClientEntityInput>) {
  const has = (k: keyof ClientEntityInput) => Object.prototype.hasOwnProperty.call(input, k);
  const missing = new Set(input.missingFields ?? []);
  // A field marked missing has no value: a half-typed number next to a
  // "missing" mark is two answers to one question.
  const value = (k: EntityField, v: string | null) => (missing.has(k) ? null : v);
  return {
    name: has("name") ? clean(input.name) ?? undefined : undefined,
    legalName: has("legalName") ? value("legalName", clean(input.legalName)) : undefined,
    registrationNumber: has("registrationNumber") ? value("registrationNumber", clean(input.registrationNumber)) : undefined,
    country: has("country") ? value("country", code(input.country, 2, "קוד המדינה")) : undefined,
    currency: has("currency") ? value("currency", code(input.currency, 3, "קוד המטבע")) : undefined,
    billingAddress: has("billingAddress") ? value("billingAddress", clean(input.billingAddress)) : undefined,
  };
}

async function assertParent(clientId: string, parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw new Error("ישות לא יכולה להיות האם של עצמה.");
  await assertEntityBelongs(clientId, parentId);
  // No cycles: walk up from the parent and make sure we are not on the way.
  let cursor: string | null = parentId;
  for (let i = 0; cursor && i < 20; i++) {
    if (cursor === selfId) throw new Error("זה היה יוצר מעגל בין ישויות.");
    const next: { parentId: string | null } | null = await prisma.clientEntity.findUnique({ where: { id: cursor }, select: { parentId: true } });
    cursor = next?.parentId ?? null;
  }
}

export async function addClientEntity(actor: User, input: ClientEntityInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  const name = clean(input.name);
  if (!name) throw new Error("צריך שם לישות.");
  assertResolvable(input.knowledgeStatus, input.toResolve);
  await assertParent(input.clientId, input.parentId);
  const fieldStatus = fieldStatusFor(input.missingFields, input.missingToResolve);
  const sourced = await sourcedFields(input.clientId, input, []);

  const entity = await prisma.clientEntity.create({
    data: {
      ...entityData(input),
      name,
      clientId: input.clientId,
      parentId: input.parentId || null,
      createdById: actor.id,
      ...knowledgeData({ ...input, fieldStatus }),
      ...sourced,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client_entity.add",
    entityType: "ClientEntity",
    entityId: entity.id,
    clientId: input.clientId,
    after: entity,
  });
  return entity;
}

export async function updateClientEntity(actor: User, id: string, input: Partial<Omit<ClientEntityInput, "clientId">>) {
  assertCan(actor.role, "time_entry.create_self");
  const before = await prisma.clientEntity.findUnique({ where: { id } });
  if (!before || before.deletedAt) throw new Error("הישות לא נמצאה.");
  await assertClientAccess(actor, before.clientId);
  if (input.name !== undefined && !clean(input.name)) throw new Error("צריך שם לישות.");
  assertResolvable(input.knowledgeStatus ?? before.knowledgeStatus, input.toResolve !== undefined ? input.toResolve : before.toResolve);
  if (input.parentId !== undefined) await assertParent(before.clientId, input.parentId, id);
  const fieldStatus = fieldStatusFor(input.missingFields, input.missingToResolve);
  const sourced = await sourcedFields(before.clientId, input, [], before);

  const updated = await prisma.clientEntity.update({
    where: { id },
    data: {
      ...entityData(input),
      parentId: input.parentId !== undefined ? input.parentId || null : undefined,
      ...knowledgeData({ ...input, fieldStatus }),
      ...sourced,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client_entity.update",
    entityType: "ClientEntity",
    entityId: id,
    clientId: before.clientId,
    before,
    after: updated,
  });
  // Decision 6: the dates of its processes follow its country.
  if (updated.country !== before.country) await syncDateCalendars({ clientId: before.clientId });
  return updated;
}

/// Refused while anything points at it: removing Inc would quietly turn
/// "Shani, Inc" into "Shani", which is the mix-up entities exist to stop.
export async function removeClientEntity(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const entity = await prisma.clientEntity.findUnique({ where: { id } });
  if (!entity || entity.deletedAt) throw new Error("הישות לא נמצאה.");
  await assertClientAccess(actor, entity.clientId);
  const [contacts, systems, children] = await Promise.all([
    prisma.clientContact.count({ where: { entityId: id, deletedAt: null } }),
    prisma.systemAccess.count({ where: { entityId: id, deletedAt: null } }),
    prisma.clientEntity.count({ where: { parentId: id, deletedAt: null } }),
  ]);
  const uses = contacts + systems + children;
  if (uses > 0) throw new Error(`${entity.name} משויכת ל-${uses} פריטים בתיק. קודם צריך לשייך אותם מחדש.`);
  const removed = await prisma.clientEntity.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "client_entity.remove",
    entityType: "ClientEntity",
    entityId: id,
    clientId: entity.clientId,
    before: entity,
  });
  return removed;
}

export async function listClientEntities(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true } });
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const rows = await prisma.clientEntity.findMany({
    where: { clientId, deletedAt: null },
    include: { parent: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.filter((r) => canSeeKnowledgeItem(r, viewer, client?.accountManagerId ?? null));
}

