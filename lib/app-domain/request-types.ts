import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSeeKnowledgeItem } from "@/lib/knowledge";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { assertEntityBelongs } from "@/lib/app-domain/client-entities";
import { assertResolvable, knowledgeData, sourcedFields, type KnowledgeInput } from "@/lib/app-domain/knowledge-items";
import type { User } from "@prisma/client";

// Org brain, phase 2: request types and how they are answered
// (claude/org-brain-spec-2026-10-12.md, 3.7; section 7.5 of Hadas's
// file). "Inc invoice from a supplier, arrives at billing-us, goes to
// Shani and Jenan, not to Ayala": the line a new Operations Manager needs
// on day one, and the one that is otherwise only in somebody's head.
//
// Routing points at people in this client's file, so a renamed contact
// stays routed, and a person from another client's file can never be.

export interface RequestTypeInput extends KnowledgeInput {
  clientId: string;
  title: string;
  fromWho?: string | null;
  arrivesVia?: string | null;
  handling: string;
  routeToContactIds?: string[];
  entityId?: string | null;
}

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

async function assertRoutes(clientId: string, ids: string[] | undefined) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  if (unique.length === 0) return unique;
  const found = await prisma.clientContact.count({ where: { id: { in: unique }, clientId, deletedAt: null } });
  if (found !== unique.length) throw new Error("איש קשר שנבחר לא נמצא בתיק של הלקוח.");
  return unique;
}

export async function addRequestType(actor: User, input: RequestTypeInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  const title = clean(input.title);
  const handling = clean(input.handling);
  if (!title) throw new Error("צריך שם לסוג הפנייה.");
  if (!handling) throw new Error("צריך לכתוב איך עונים ולאן מעבירים.");
  assertResolvable(input.knowledgeStatus, input.toResolve);
  await assertEntityBelongs(input.clientId, input.entityId);
  const routes = await assertRoutes(input.clientId, input.routeToContactIds);
  const sourced = await sourcedFields(input.clientId, input, [handling]);
  const row = await prisma.requestType.create({
    data: {
      clientId: input.clientId,
      title,
      fromWho: clean(input.fromWho),
      arrivesVia: clean(input.arrivesVia),
      handling,
      routeToContactIds: routes,
      entityId: input.entityId || null,
      createdById: actor.id,
      ...knowledgeData(input),
      ...sourced,
    },
  });
  await recordAudit({ actorId: actor.id, action: "request_type.add", entityType: "RequestType", entityId: row.id, clientId: input.clientId, after: row });
  return row;
}

export async function updateRequestType(actor: User, id: string, input: Partial<Omit<RequestTypeInput, "clientId">>) {
  assertCan(actor.role, "time_entry.create_self");
  const before = await prisma.requestType.findUnique({ where: { id } });
  if (!before || before.deletedAt) throw new Error("סוג הפנייה לא נמצא.");
  await assertClientAccess(actor, before.clientId);
  if (input.title !== undefined && !clean(input.title)) throw new Error("צריך שם לסוג הפנייה.");
  if (input.handling !== undefined && !clean(input.handling)) throw new Error("צריך לכתוב איך עונים ולאן מעבירים.");
  assertResolvable(input.knowledgeStatus ?? before.knowledgeStatus, input.toResolve !== undefined ? input.toResolve : before.toResolve);
  if (input.entityId !== undefined) await assertEntityBelongs(before.clientId, input.entityId);
  const routes = input.routeToContactIds !== undefined ? await assertRoutes(before.clientId, input.routeToContactIds) : undefined;
  const sourced = await sourcedFields(before.clientId, input, [input.handling !== undefined ? input.handling : before.handling], before);
  const updated = await prisma.requestType.update({
    where: { id },
    data: {
      title: input.title !== undefined ? clean(input.title)! : undefined,
      fromWho: input.fromWho !== undefined ? clean(input.fromWho) : undefined,
      arrivesVia: input.arrivesVia !== undefined ? clean(input.arrivesVia) : undefined,
      handling: input.handling !== undefined ? clean(input.handling)! : undefined,
      routeToContactIds: routes,
      entityId: input.entityId !== undefined ? input.entityId || null : undefined,
      ...knowledgeData(input),
      ...sourced,
    },
  });
  await recordAudit({ actorId: actor.id, action: "request_type.update", entityType: "RequestType", entityId: id, clientId: before.clientId, before, after: updated });
  return updated;
}

export async function removeRequestType(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const row = await prisma.requestType.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw new Error("סוג הפנייה לא נמצא.");
  await assertClientAccess(actor, row.clientId);
  const removed = await prisma.requestType.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "request_type.remove", entityType: "RequestType", entityId: id, clientId: row.clientId, before: row });
  return removed;
}

/// With the names it routes to, from this client's file only. A contact
/// removed since is simply not named.
export async function listRequestTypes(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true } });
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const rows = await prisma.requestType.findMany({
    where: { clientId, deletedAt: null },
    include: { entity: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const contactIds = [...new Set(rows.flatMap((r) => r.routeToContactIds))];
  const contacts = await prisma.clientContact.findMany({
    where: { id: { in: contactIds }, clientId, deletedAt: null },
    select: { id: true, role: true, person: { select: { name: true } } },
  });
  const nameOf = new Map(contacts.map((c) => [c.id, c.person.name ?? c.role ?? ""]));
  return rows
    .filter((r) => canSeeKnowledgeItem(r, viewer, client?.accountManagerId ?? null))
    .map((r) => ({ ...r, routeToNames: r.routeToContactIds.map((id) => nameOf.get(id)).filter((n): n is string => !!n) }));
}
