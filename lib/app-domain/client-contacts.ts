import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { normalizeDomain, normalizeEmail, normalizePhone } from "@/lib/contact-normalize";
import { canSeeKnowledgeItem } from "@/lib/knowledge";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { assertResolvable, knowledgeData, sourcedFields, type KnowledgeInput } from "@/lib/app-domain/knowledge-items";
import type {
  User,
  ContactRelationship,
} from "@prisma/client";

// Org brain, phase 2: the people and organizations in a client's file
// (claude/org-brain-spec-2026-10-12.md, sections 3.1 and 3.5, decisions 2
// and 8).
//
// The shape that matters: a Person and an Organization exist once for all
// of Ankora, and a client's file links to them. Email and phone belong to
// the person, so fixing them once fixes them everywhere. Everything that
// depends on the client - role, context, who may see it, whether it is
// confirmed - lives on the link and never crosses to another client. A
// user who works on client A sees Shani as client A knows her, and nothing
// tells them she also works with client B.
//
// Access is the same rule as every other client screen: you must be able
// to reach the client. Within it, each item's audience decides
// (lib/knowledge.ts).


function cleanList(values: string[] | undefined, normalize: (v: string) => string | null): string[] {
  const out: string[] = [];
  for (const v of values ?? []) {
    const n = normalize(v);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/// The organization with one of these domains, else one with this exact
/// name (ignoring case), else a new one. Domain first, because a domain is
/// an identity and a name is a spelling.
async function findOrCreateOrganization(name: string, domains: string[]) {
  const cleanName = name.trim();
  const cleanDomains = cleanList(domains, normalizeDomain);
  if (cleanDomains.length > 0) {
    const byDomain = await prisma.organization.findFirst({ where: { deletedAt: null, domains: { hasSome: cleanDomains } } });
    if (byDomain) {
      const merged = Array.from(new Set([...byDomain.domains, ...cleanDomains]));
      return merged.length === byDomain.domains.length
        ? byDomain
        : prisma.organization.update({ where: { id: byDomain.id }, data: { domains: merged } });
    }
  }
  if (!cleanName) throw new Error("צריך שם ארגון או דומיין.");
  const byName = await prisma.organization.findFirst({
    where: { deletedAt: null, name: { equals: cleanName, mode: "insensitive" } },
  });
  if (byName) {
    const merged = Array.from(new Set([...byName.domains, ...cleanDomains]));
    return merged.length === byName.domains.length
      ? byName
      : prisma.organization.update({ where: { id: byName.id }, data: { domains: merged } });
  }
  return prisma.organization.create({ data: { name: cleanName, domains: cleanDomains } });
}

/// Organization names for the picker: only organizations already in the
/// file of a client this person can reach. Not every organization in
/// Ankora: a private client's lawyer is nobody else's business, and a name
/// in a dropdown is a disclosure.
export async function listOrganizationNames(actor: User, clientId: string): Promise<string[]> {
  await assertClientAccess(actor, clientId);
  const clientIds = (await listAccessibleClients(actor)).map((c) => c.id);
  const orgs = await prisma.organization.findMany({
    where: {
      deletedAt: null,
      OR: [
        { clients: { some: { clientId: { in: clientIds }, deletedAt: null } } },
        { people: { some: { contacts: { some: { clientId: { in: clientIds }, deletedAt: null } } } } },
      ],
    },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return orgs.map((o) => o.name);
}

export interface ClientOrganizationInput extends KnowledgeInput {
  clientId: string;
  name: string;
  domains?: string[];
  role?: string | null;
  relationship?: ContactRelationship;
  monthlyCostMinor?: number | null;
  currency?: string | null;
  notes?: string | null;
}

export async function addClientOrganization(actor: User, input: ClientOrganizationInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  assertResolvable(input.knowledgeStatus, input.toResolve);
  if (input.monthlyCostMinor != null && (!Number.isInteger(input.monthlyCostMinor) || input.monthlyCostMinor < 0)) {
    throw new Error("עלות חודשית לא תקינה.");
  }

  // Checked before anything is written: a refused source must not leave
  // a new organization behind.
  const sourced = await sourcedFields(input.clientId, input, [input.notes]);
  const organization = await findOrCreateOrganization(input.name, input.domains ?? []);
  const existing = await prisma.clientOrganization.findUnique({
    where: { clientId_organizationId: { clientId: input.clientId, organizationId: organization.id } },
  });
  if (existing && !existing.deletedAt) throw new Error(`${organization.name} כבר בתיק של הלקוח.`);

  const data = {
    role: input.role?.trim() || null,
    relationship: input.relationship ?? "PROVIDER",
    monthlyCostMinor: input.monthlyCostMinor ?? null,
    currency: input.currency?.trim() || null,
    notes: input.notes?.trim() || null,
    ...knowledgeData(input),
    ...sourced,
  };
  // A link removed earlier comes back, with its history, rather than
  // tripping over the unique constraint.
  const link = existing
    ? await prisma.clientOrganization.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } })
    : await prisma.clientOrganization.create({
        data: { ...data, clientId: input.clientId, organizationId: organization.id, createdById: actor.id },
      });

  await recordAudit({
    actorId: actor.id,
    action: "client_organization.add",
    entityType: "ClientOrganization",
    entityId: link.id,
    clientId: input.clientId,
    after: link,
  });
  return link;
}

export async function removeClientOrganization(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const link = await prisma.clientOrganization.findUnique({ where: { id } });
  if (!link || link.deletedAt) throw new Error("לא נמצא.");
  await assertClientAccess(actor, link.clientId);
  const removed = await prisma.clientOrganization.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "client_organization.remove",
    entityType: "ClientOrganization",
    entityId: id,
    clientId: link.clientId,
    before: link,
  });
  return removed;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/// The person with one of these emails, else one of these phones, else a
/// new one. Email first: an address is personal far more often than a
/// switchboard number is. Details that are new are added; nothing typed
/// earlier is replaced, because the earlier entry may be the right one.
async function findOrCreatePerson(input: { name: string | null; emails: string[]; phones: string[]; organizationId: string | null }) {
  const match =
    (input.emails.length > 0
      ? await prisma.person.findFirst({ where: { deletedAt: null, emails: { hasSome: input.emails } } })
      : null) ??
    (input.phones.length > 0
      ? await prisma.person.findFirst({ where: { deletedAt: null, phones: { hasSome: input.phones } } })
      : null);

  if (!match) {
    return prisma.person.create({
      data: { name: input.name, emails: input.emails, phones: input.phones, organizationId: input.organizationId },
    });
  }
  const emails = Array.from(new Set([...match.emails, ...input.emails]));
  const phones = Array.from(new Set([...match.phones, ...input.phones]));
  return prisma.person.update({
    where: { id: match.id },
    data: {
      emails,
      phones,
      name: match.name ?? input.name,
      organizationId: match.organizationId ?? input.organizationId,
    },
  });
}

export interface ClientContactInput extends KnowledgeInput {
  clientId: string;
  name?: string | null;
  emails?: string[];
  phones?: string[];
  organizationName?: string | null;
  role?: string | null;
  relationship?: ContactRelationship;
  entityLabel?: string | null;
  context?: string | null;
  channelOrder?: string[];
  isPrimary?: boolean;
  isDecisionMaker?: boolean;
  clientSideAddress?: string | null;
}

export async function addClientContact(actor: User, input: ClientContactInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  assertResolvable(input.knowledgeStatus, input.toResolve);

  const name = input.name?.trim() || null;
  const role = input.role?.trim() || null;
  // "The cleaner" has no name but has a role. Somebody with neither is
  // nobody anyone can find again.
  if (!name && !role) throw new Error("צריך שם או תפקיד.");

  const sourced = await sourcedFields(input.clientId, input, [input.context]);
  const emails = cleanList(input.emails, normalizeEmail);
  const phones = cleanList(input.phones, normalizePhone);
  const organization = input.organizationName?.trim() ? await findOrCreateOrganization(input.organizationName, []) : null;
  const person = await findOrCreatePerson({ name, emails, phones, organizationId: organization?.id ?? null });

  const existing = await prisma.clientContact.findUnique({
    where: { clientId_personId: { clientId: input.clientId, personId: person.id } },
  });
  if (existing && !existing.deletedAt) throw new Error(`${person.name ?? "איש הקשר"} כבר בתיק של הלקוח.`);

  const data = {
    role,
    relationship: input.relationship ?? "CLIENT_STAFF",
    entityLabel: input.entityLabel?.trim() || null,
    context: input.context?.trim() || null,
    channelOrder: (input.channelOrder ?? []).map((c) => c.trim()).filter(Boolean),
    isPrimary: input.isPrimary ?? false,
    isDecisionMaker: input.isDecisionMaker ?? false,
    clientSideAddress: input.clientSideAddress?.trim() || null,
    ...knowledgeData(input),
    ...sourced,
  };
  const contact = existing
    ? await prisma.clientContact.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } })
    : await prisma.clientContact.create({
        data: { ...data, clientId: input.clientId, personId: person.id, createdById: actor.id },
      });

  // One primary contact per client: setting a new one clears the old.
  if (contact.isPrimary) {
    await prisma.clientContact.updateMany({
      where: { clientId: input.clientId, id: { not: contact.id }, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: "client_contact.add",
    entityType: "ClientContact",
    entityId: contact.id,
    clientId: input.clientId,
    after: contact,
  });
  return contact;
}

export async function updateClientContact(actor: User, id: string, input: Partial<Omit<ClientContactInput, "clientId">>) {
  assertCan(actor.role, "time_entry.create_self");
  const before = await prisma.clientContact.findUnique({ where: { id }, include: { person: true } });
  if (!before || before.deletedAt) throw new Error("איש הקשר לא נמצא.");
  await assertClientAccess(actor, before.clientId);
  assertResolvable(input.knowledgeStatus ?? before.knowledgeStatus, input.toResolve !== undefined ? input.toResolve : before.toResolve);

  const sourced = await sourcedFields(before.clientId, input, [input.context !== undefined ? input.context : before.context], before);

  // The person's own details are shared across clients (decision 8). An
  // address that already belongs to somebody else is refused rather than
  // silently merging two people.
  if (input.emails !== undefined || input.phones !== undefined || input.name !== undefined) {
    const emails = input.emails !== undefined ? cleanList(input.emails, normalizeEmail) : before.person.emails;
    const phones = input.phones !== undefined ? cleanList(input.phones, normalizePhone) : before.person.phones;
    const clash =
      emails.length > 0
        ? await prisma.person.findFirst({ where: { id: { not: before.personId }, deletedAt: null, emails: { hasSome: emails } } })
        : null;
    if (clash) throw new Error("כתובת המייל כבר שייכת לאיש קשר אחר.");
    const name = input.name !== undefined ? input.name?.trim() || null : before.person.name;
    if (!name && !(input.role !== undefined ? input.role?.trim() : before.role)) throw new Error("צריך שם או תפקיד.");
    await prisma.person.update({ where: { id: before.personId }, data: { emails, phones, name } });
  }

  const updated = await prisma.clientContact.update({
    where: { id },
    data: {
      role: input.role !== undefined ? input.role?.trim() || null : undefined,
      relationship: input.relationship ?? undefined,
      entityLabel: input.entityLabel !== undefined ? input.entityLabel?.trim() || null : undefined,
      context: input.context !== undefined ? input.context?.trim() || null : undefined,
      channelOrder: input.channelOrder !== undefined ? input.channelOrder.map((c) => c.trim()).filter(Boolean) : undefined,
      isPrimary: input.isPrimary ?? undefined,
      isDecisionMaker: input.isDecisionMaker ?? undefined,
      clientSideAddress: input.clientSideAddress !== undefined ? input.clientSideAddress?.trim() || null : undefined,
      ...knowledgeData(input),
      ...sourced,
    },
  });
  if (updated.isPrimary && !before.isPrimary) {
    await prisma.clientContact.updateMany({
      where: { clientId: before.clientId, id: { not: id }, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: "client_contact.update",
    entityType: "ClientContact",
    entityId: id,
    clientId: before.clientId,
    before,
    after: updated,
  });
  return updated;
}

export async function removeClientContact(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const contact = await prisma.clientContact.findUnique({ where: { id } });
  if (!contact || contact.deletedAt) throw new Error("איש הקשר לא נמצא.");
  await assertClientAccess(actor, contact.clientId);
  // Soft, like every delete here, and the person stays: they may be in
  // another client's file.
  const removed = await prisma.clientContact.update({ where: { id }, data: { deletedAt: new Date(), isPrimary: false } });
  await recordAudit({
    actorId: actor.id,
    action: "client_contact.remove",
    entityType: "ClientContact",
    entityId: id,
    clientId: contact.clientId,
    before: contact,
  });
  return removed;
}

// ---------------------------------------------------------------------------
// Reading the file's people
// ---------------------------------------------------------------------------

/// Section 3 and 7.2 of the client file: the people and the organizations,
/// each filtered by its own audience. Primary first, then decision makers,
/// then by name.
export async function listClientPeople(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true } });
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const accountManagerId = client?.accountManagerId ?? null;

  const [contacts, organizations] = await Promise.all([
    prisma.clientContact.findMany({
      where: { clientId, deletedAt: null },
      include: { person: { include: { organization: { select: { id: true, name: true } } } } },
    }),
    prisma.clientOrganization.findMany({
      where: { clientId, deletedAt: null },
      include: { organization: { select: { id: true, name: true, domains: true } } },
    }),
  ]);

  const visibleContacts = contacts
    .filter((c) => canSeeKnowledgeItem(c, viewer, accountManagerId))
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        Number(b.isDecisionMaker) - Number(a.isDecisionMaker) ||
        (a.person.name ?? a.role ?? "").localeCompare(b.person.name ?? b.role ?? "", "he")
    );
  const visibleOrganizations = organizations
    .filter((o) => canSeeKnowledgeItem(o, viewer, accountManagerId))
    .sort((a, b) => a.organization.name.localeCompare(b.organization.name, "he"));

  return { contacts: visibleContacts, organizations: visibleOrganizations };
}
