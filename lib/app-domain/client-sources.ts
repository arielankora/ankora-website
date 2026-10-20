import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ForbiddenError, assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { emailDomain, isPublicEmailDomain, normalizeDomain } from "@/lib/contact-normalize";
import {
  checkSources,
  defaultWeight,
  readSourceRefs,
  sourceCode,
  SECONDARY_ONLY_TO_RESOLVE,
  type RegisterEntry,
  type SourceRef,
} from "@/lib/knowledge-sources";
import type {
  User,
  ClientDomainKind,
  KnowledgeStatus,
  SourceKind,
  SourceRestriction,
  SourceWeight,
} from "@prisma/client";

// Org brain, phase 2: the client's source register and domains
// (claude/org-brain-spec-2026-10-12.md, sections 3.2 and 3.5).
//
// The register is what makes the file trustworthy: every item says where
// it came from, and "where" is a short code a reader can look up. Codes
// are per client and never reused, so "S3" in an old note still means
// what it meant when it was written, even after S3 is removed.

export async function assertClientAccess(actor: User, clientId: string) {
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type ExternalRef = { system: "FIREFLIES" | "DOCUMENT" | "TASK" | "OTHER"; id: string };

/// What an external id on a source of this kind points at.
export function externalSystemFor(kind: SourceKind): ExternalRef["system"] {
  switch (kind) {
    case "TRANSCRIPT":
      return "FIREFLIES";
    case "CLIENT_DOCUMENT":
    case "ANKORA_DOCUMENT":
      return "DOCUMENT";
    case "TASK":
      return "TASK";
    default:
      return "OTHER";
  }
}

/// A document or a task named as a source must be this client's. Anything
/// else would let one client's file cite another client's material.
async function assertRefsBelong(clientId: string, refs: ExternalRef[]) {
  const docIds = refs.filter((r) => r.system === "DOCUMENT").map((r) => r.id);
  const taskIds = refs.filter((r) => r.system === "TASK").map((r) => r.id);
  if (docIds.length > 0) {
    const found = await prisma.clientDocument.count({ where: { id: { in: docIds }, clientId, deletedAt: null } });
    if (found !== new Set(docIds).size) throw new Error("מסמך שצוין כמקור לא נמצא בתיק של הלקוח.");
  }
  if (taskIds.length > 0) {
    const found = await prisma.task.count({ where: { id: { in: taskIds }, clientId, deletedAt: null } });
    if (found !== new Set(taskIds).size) throw new Error("משימה שצוינה כמקור לא נמצאה אצל הלקוח.");
  }
}

export interface ClientSourceInput {
  clientId: string;
  kind: SourceKind;
  title: string;
  weight?: SourceWeight;
  occurredAt?: Date | null;
  participants?: string[];
  externalIds?: string[];
  restriction?: SourceRestriction;
  notes?: string | null;
}

export async function addClientSource(actor: User, input: ClientSourceInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  const title = input.title.trim();
  if (!title) throw new Error("צריך שם למקור.");
  const system = externalSystemFor(input.kind);
  const externalRefs: ExternalRef[] = [...new Set((input.externalIds ?? []).map((i) => i.trim()).filter(Boolean))].map(
    (id) => ({ system, id })
  );
  await assertRefsBelong(input.clientId, externalRefs);

  // The next number, never reused: removed sources keep theirs. Two people
  // adding at once collide on the unique key, and the loser takes the next.
  for (let attempt = 0; ; attempt++) {
    const last = await prisma.clientSource.findFirst({
      where: { clientId: input.clientId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (last?.seq ?? 0) + 1;
    try {
      const source = await prisma.clientSource.create({
        data: {
          clientId: input.clientId,
          seq,
          code: sourceCode(seq),
          kind: input.kind,
          weight: input.weight ?? defaultWeight(input.kind),
          title,
          occurredAt: input.occurredAt ?? null,
          participants: (input.participants ?? []).map((p) => p.trim()).filter(Boolean),
          externalRefs: externalRefs as Prisma.InputJsonValue,
          restriction: input.restriction ?? "NONE",
          notes: input.notes?.trim() || null,
          createdById: actor.id,
        },
      });
      await recordAudit({
        actorId: actor.id,
        action: "client_source.add",
        entityType: "ClientSource",
        entityId: source.id,
        clientId: input.clientId,
        after: source,
      });
      return source;
    } catch (err) {
      if (attempt < 3 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
}

/// How many live items in the client's file cite this code.
export async function countSourceUses(clientId: string, code: string): Promise<number> {
  const needle = JSON.stringify([{ code }]);
  // Cited in free text as "[S3 08:13]": the code as a whole word inside
  // brackets, so S1 does not count S10's citations.
  const cited = `\\[[^\\]]*\\m${code}\\M`;
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT
      (SELECT count(*) FROM "client_contacts"
        WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL
          AND ("sources" @> ${needle}::jsonb OR "context" ~* ${cited}))
      +
      (SELECT count(*) FROM "client_organizations"
        WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL
          AND ("sources" @> ${needle}::jsonb OR "notes" ~* ${cited}))
      +
      (SELECT count(*) FROM "system_access"
        WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL
          AND ("sources" @> ${needle}::jsonb OR "notes" ~* ${cited}))
      +
      (SELECT count(*) FROM "client_facts"
        WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL
          AND ("sources" @> ${needle}::jsonb OR "body" ~* ${cited} OR "answer" ~* ${cited}))
      +
      (SELECT count(*) FROM "client_entities"
        WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL AND "sources" @> ${needle}::jsonb)
      +
      (SELECT count(*) FROM "request_types"
        WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL
          AND ("sources" @> ${needle}::jsonb OR "handling" ~* ${cited}))
      +
      (SELECT count(*) FROM "client_policies"
        WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL
          AND ("sources" @> ${needle}::jsonb OR "statement" ~* ${cited}))
      +
      (SELECT count(*) FROM "client_narratives" n
        WHERE n."clientId" = ${clientId} AND n."body" ~* ${cited}
          AND n."version" = (SELECT max(m."version") FROM "client_narratives" m WHERE m."clientId" = n."clientId" AND m."kind" = n."kind"))
      AS n`;
  return Number(rows[0]?.n ?? 0);
}

export async function updateClientSource(
  actor: User,
  id: string,
  input: Partial<Omit<ClientSourceInput, "clientId" | "kind" | "externalIds">>
) {
  assertCan(actor.role, "time_entry.create_self");
  const before = await prisma.clientSource.findUnique({ where: { id } });
  if (!before || before.deletedAt) throw new Error("המקור לא נמצא.");
  await assertClientAccess(actor, before.clientId);
  if (input.title !== undefined && !input.title.trim()) throw new Error("צריך שם למקור.");
  // Weight decides whether the items citing a source can be confirmed
  // (R14). Changing it under them would change their status silently.
  if (input.weight && input.weight !== before.weight) {
    const uses = await countSourceUses(before.clientId, before.code);
    if (uses > 0) throw new Error(`${before.code} כבר משמש ב-${uses} פריטים בתיק, ולכן אי אפשר לשנות את המשקל שלו.`);
  }
  const updated = await prisma.clientSource.update({
    where: { id },
    data: {
      title: input.title?.trim() ?? undefined,
      weight: input.weight ?? undefined,
      occurredAt: input.occurredAt !== undefined ? input.occurredAt : undefined,
      participants: input.participants?.map((p) => p.trim()).filter(Boolean) ?? undefined,
      restriction: input.restriction ?? undefined,
      notes: input.notes !== undefined ? input.notes?.trim() || null : undefined,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client_source.update",
    entityType: "ClientSource",
    entityId: id,
    clientId: before.clientId,
    before,
    after: updated,
  });
  return updated;
}

export async function removeClientSource(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const source = await prisma.clientSource.findUnique({ where: { id } });
  if (!source || source.deletedAt) throw new Error("המקור לא נמצא.");
  await assertClientAccess(actor, source.clientId);
  const uses = await countSourceUses(source.clientId, source.code);
  if (uses > 0) throw new Error(`${source.code} משמש ב-${uses} פריטים בתיק. קודם צריך להחליף להם את המקור.`);
  const removed = await prisma.clientSource.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "client_source.remove",
    entityType: "ClientSource",
    entityId: id,
    clientId: source.clientId,
    before: source,
  });
  return removed;
}

export async function listClientSources(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  return prisma.clientSource.findMany({ where: { clientId, deletedAt: null }, orderBy: { seq: "asc" } });
}

async function loadRegister(clientId: string): Promise<RegisterEntry[]> {
  return prisma.clientSource.findMany({
    where: { clientId, deletedAt: null },
    select: { code: true, weight: true },
  });
}

/// The source rules for one item about to be written (spec 1.6, R14,
/// R17). Returns what to store: the refs, and the status and toResolve
/// after R14 may have lowered it.
export async function resolveItemSources(
  clientId: string,
  item: { status: KnowledgeStatus; refs: SourceRef[]; toResolve: string | null; texts: (string | null | undefined)[]; confirmedByPerson?: boolean }
): Promise<{ sources: SourceRef[]; knowledgeStatus: KnowledgeStatus; toResolve: string | null }> {
  const check = checkSources(item.status, item.refs, await loadRegister(clientId), item.texts, item.confirmedByPerson);
  if (!check.ok) throw new Error(check.error);
  return {
    sources: item.refs,
    knowledgeStatus: check.status as KnowledgeStatus,
    toResolve: check.lowered
      ? item.toResolve?.trim() || SECONDARY_ONLY_TO_RESOLVE
      : // Confirmed after all: "what would confirm it" no longer applies.
        check.status === "CONFIRMED" && item.toResolve === SECONDARY_ONLY_TO_RESOLVE
        ? null
        : item.toResolve,
  };
}

export { readSourceRefs };

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export interface ClientDomainInput {
  clientId: string;
  domain: string;
  kind: ClientDomainKind;
  /// For a partner domain: the organization's name. Found or created like
  /// any organization in the file.
  organizationName?: string | null;
  notes?: string | null;
}

export async function addClientDomain(actor: User, input: ClientDomainInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error("דומיין לא תקין.");
  if (isPublicEmailDomain(domain)) throw new Error(`${domain} הוא שירות מייל ציבורי, ולא מזהה לקוח.`);

  // A client's own domain is one client's. A partner's may be several
  // clients' (decision 8), which is why it never assigns a message alone.
  if (input.kind === "CLIENT") {
    const owner = await prisma.clientDomain.findFirst({
      where: { domain, kind: "CLIENT", deletedAt: null, clientId: { not: input.clientId } },
    });
    if (owner) throw new Error(`${domain} כבר רשום כדומיין של לקוח אחר.`);
  }

  let organizationId: string | null = null;
  if (input.kind === "PARTNER") {
    const name = input.organizationName?.trim();
    const org =
      (await prisma.organization.findFirst({ where: { deletedAt: null, domains: { has: domain } } })) ??
      (name
        ? await prisma.organization.findFirst({ where: { deletedAt: null, name: { equals: name, mode: "insensitive" } } })
        : null);
    if (org) {
      organizationId = org.id;
      if (!org.domains.includes(domain)) {
        await prisma.organization.update({ where: { id: org.id }, data: { domains: [...org.domains, domain] } });
      }
    } else if (name) {
      organizationId = (await prisma.organization.create({ data: { name, domains: [domain] } })).id;
    }
  }

  const existing = await prisma.clientDomain.findUnique({ where: { clientId_domain: { clientId: input.clientId, domain } } });
  if (existing && !existing.deletedAt) throw new Error(`${domain} כבר ברשימה.`);
  const data = { kind: input.kind, organizationId, notes: input.notes?.trim() || null };
  const row = existing
    ? await prisma.clientDomain.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } })
    : await prisma.clientDomain.create({ data: { ...data, clientId: input.clientId, domain, createdById: actor.id } });

  await recordAudit({
    actorId: actor.id,
    action: "client_domain.add",
    entityType: "ClientDomain",
    entityId: row.id,
    clientId: input.clientId,
    after: row,
  });
  return row;
}

export async function removeClientDomain(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const row = await prisma.clientDomain.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw new Error("הדומיין לא נמצא.");
  await assertClientAccess(actor, row.clientId);
  const removed = await prisma.clientDomain.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "client_domain.remove",
    entityType: "ClientDomain",
    entityId: id,
    clientId: row.clientId,
    before: row,
  });
  return removed;
}

export async function listClientDomains(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  return prisma.clientDomain.findMany({
    where: { clientId, deletedAt: null },
    include: { organization: { select: { name: true } } },
    orderBy: [{ kind: "asc" }, { domain: "asc" }],
  });
}

/// Which of the clients this person can reach an address belongs to
/// (spec 5.1). A client domain is a match on its own; a partner domain
/// only says "one of these", because the firm may serve several. Clients
/// the person cannot reach are never mentioned.
export async function clientsForEmail(
  actor: User,
  email: string
): Promise<{ clientId: string; kind: ClientDomainKind }[]> {
  const domain = emailDomain(email);
  if (!domain || isPublicEmailDomain(domain)) return [];
  const accessible = (await listAccessibleClients(actor)).map((c) => c.id);
  const rows = await prisma.clientDomain.findMany({
    where: { domain, deletedAt: null, clientId: { in: accessible } },
    select: { clientId: true, kind: true },
    orderBy: { kind: "asc" },
  });
  return rows;
}
