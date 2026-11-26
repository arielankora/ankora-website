import "server-only";
import { DomainError } from "@/lib/domain-error";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { ensureDefaultAlertRules } from "@/lib/app-domain/alerts";
import { updateClient } from "@/lib/app-domain/clients";
import { addClientDomain, addClientSource, removeClientDomain } from "@/lib/app-domain/client-sources";
import { addClientContact, addClientOrganization, removeClientContact, removeClientOrganization, updateClientContact } from "@/lib/app-domain/client-contacts";
import { addClientPolicy, removeClientPolicy } from "@/lib/app-domain/client-policies";
import { readSourceRefs, type SourceRef } from "@/lib/knowledge-sources";
import { ONBOARDING_STEPS, REQUIREMENT_STEP, REQUIREMENT_TEXT, onboardingMissing, unreachableContacts, type OnboardingRequirement } from "@/lib/client-onboarding";
import type { AppLocale, ClientChannel, ClientKind, SourceKind, User } from "@prisma/client";

// New-client wizard (26.11.2026, design approved by Ariel the same day).
//
// A client is created at the end of the wizard's first step, as ONBOARDING,
// and filled step by step: from the screen, or by Claude through the
// onboarding tools of the connector. Nothing that runs on its own reaches
// it until it is activated (listAccessibleClients returns ACTIVE only; see
// tests/integration/client-onboarding-guards.test.ts). Activation checks
// what the automation needs (lib/client-onboarding.ts) and happens on the
// summary screen only.
//
// Every write goes through the file's own domain functions, so a contact
// added here is the same contact the file screen shows, with the same
// rules: shared people, sources, refusals.

/// The source every item typed into the wizard cites: what the person
/// setting the client up was told. Claude cites its own (an email, a
/// meeting, a document).
export const SETUP_SOURCE_TITLE = "פרטים שנמסרו בהקמת הלקוח";

export type RuleKindInSetup = "DATA_HANDLING" | "DISCLOSURE";

async function onboardingClient(actor: User, clientId: string) {
  assertCan(actor.role, "client.manage");
  const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
  if (!client) throw new DomainError("clients.notFound", "הלקוח לא נמצא.");
  if (client.status !== "ONBOARDING") throw new DomainError("clientOnboarding.notOnboarding", "הלקוח כבר הופעל. מעדכנים אותו בתיק הלקוח.");
  return client;
}

async function setupSourceCode(clientId: string): Promise<string | null> {
  const s = await prisma.clientSource.findFirst({ where: { clientId, title: SETUP_SOURCE_TITLE, deletedAt: null }, orderBy: { seq: "asc" }, select: { code: true } });
  return s?.code ?? null;
}

/// The sources an item cites: the ones given, else the setup source.
async function sourcesFor(clientId: string, given?: SourceRef[]): Promise<SourceRef[]> {
  if (given && given.length) return given;
  const code = await setupSourceCode(clientId);
  return code ? [{ code }] : [];
}

/// The furthest step saved moves forward, never back.
async function reachStep(clientId: string, step: number) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { onboardingStep: true } });
  if ((client.onboardingStep ?? 0) < step) await prisma.client.update({ where: { id: clientId }, data: { onboardingStep: Math.min(step, ONBOARDING_STEPS) } });
}

// ---------------------------------------------------------------------------
// Step 1: who the client is, and the AI decision
// ---------------------------------------------------------------------------

export interface StartOnboardingInput {
  name: string;
  kind: ClientKind;
  industry?: string | null;
  timezone?: string;
  communicationLocale?: AppLocale;
  /// Required, with no default (Ariel, 26.11.2026): the decision is made
  /// before a single contact enters the file.
  aiExcluded: boolean;
}

export async function startClientOnboarding(actor: User, input: StartOnboardingInput) {
  assertCan(actor.role, "client.manage");
  const name = input.name?.trim();
  if (!name) throw new DomainError("clients.nameRequired", "צריך שם ללקוח.");
  if (typeof input.aiExcluded !== "boolean") {
    throw new DomainError("clientOnboarding.aiDecisionRequired", "צריך להחליט אם מותר לעבוד עם הלקוח בבינה מלאכותית, לפני שנוצר הלקוח.");
  }
  const client = await prisma.client.create({
    data: {
      name,
      kind: input.kind,
      industry: input.industry?.trim() || null,
      timezone: input.timezone || "Asia/Jerusalem",
      communicationLocale: input.communicationLocale ?? "he",
      aiExcluded: input.aiExcluded,
      status: "ONBOARDING",
      onboardingStep: 1,
    },
  });
  await recordAudit({ actorId: actor.id, action: "client.create", entityType: "Client", entityId: client.id, clientId: client.id, after: client });
  if (client.aiExcluded) {
    await recordAudit({ actorId: actor.id, action: "client.ai_excluded", entityType: "Client", entityId: client.id, clientId: client.id, after: { aiExcluded: true } });
  }
  await addClientSource(actor, { clientId: client.id, kind: "PERSON", title: SETUP_SOURCE_TITLE, participants: [actor.name ?? ""].filter(Boolean) });
  await ensureDefaultAlertRules(actor, client.id);
  return client;
}

export async function updateOnboardingIdentity(
  actor: User,
  clientId: string,
  input: { name?: string; kind?: ClientKind; industry?: string | null; timezone?: string; communicationLocale?: AppLocale; aiExcluded?: boolean },
) {
  await onboardingClient(actor, clientId);
  if (input.name !== undefined && !input.name.trim()) throw new DomainError("clients.nameRequired", "צריך שם ללקוח.");
  return updateClient(actor, clientId, input);
}

// ---------------------------------------------------------------------------
// Step 2: how the client is recognised
// ---------------------------------------------------------------------------

export async function addOnboardingDomain(actor: User, clientId: string, domain: string) {
  await onboardingClient(actor, clientId);
  const row = await addClientDomain(actor, { clientId, domain, kind: "CLIENT" });
  await reachStep(clientId, 2);
  return row;
}

export async function removeOnboardingDomain(actor: User, clientId: string, domainId: string) {
  await onboardingClient(actor, clientId);
  const row = await prisma.clientDomain.findFirst({ where: { id: domainId, clientId, deletedAt: null } });
  if (!row) throw new DomainError("clientSources.domainNotFound", "הדומיין לא נמצא.");
  return removeClientDomain(actor, domainId);
}

export async function addOnboardingPartner(
  actor: User,
  clientId: string,
  input: { name: string; domain?: string | null; role?: string | null; sources?: SourceRef[] },
) {
  await onboardingClient(actor, clientId);
  const link = await addClientOrganization(actor, {
    clientId,
    name: input.name,
    domains: input.domain ? [input.domain] : [],
    role: input.role ?? null,
    relationship: "PROVIDER",
    sources: await sourcesFor(clientId, input.sources),
  });
  await reachStep(clientId, 2);
  return link;
}

export async function removeOnboardingPartner(actor: User, clientId: string, partnerId: string) {
  await onboardingClient(actor, clientId);
  const link = await prisma.clientOrganization.findFirst({ where: { id: partnerId, clientId, deletedAt: null }, include: { organization: true } });
  if (!link) throw new DomainError("clientContacts.notFound", "לא נמצא.");
  await removeClientOrganization(actor, partnerId);
  // Its partner domains go with it: they were added for it.
  await prisma.clientDomain.updateMany({
    where: { clientId, kind: "PARTNER", organizationId: link.organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

export async function setOnboardingChannel(actor: User, clientId: string, input: { preferredChannel: ClientChannel | null; whatsappNumber?: string | null }) {
  await onboardingClient(actor, clientId);
  const client = await updateClient(actor, clientId, { preferredChannel: input.preferredChannel, whatsappNumber: input.whatsappNumber });
  await reachStep(clientId, 2);
  return client;
}

// ---------------------------------------------------------------------------
// Step 3: the people
// ---------------------------------------------------------------------------

export interface OnboardingContactInput {
  name?: string | null;
  role?: string | null;
  emails?: string[];
  phones?: string[];
  isDecisionMaker?: boolean;
  isPrimary?: boolean;
  sources?: SourceRef[];
}

export async function addOnboardingContact(actor: User, clientId: string, input: OnboardingContactInput) {
  await onboardingClient(actor, clientId);
  const contact = await addClientContact(actor, {
    clientId,
    name: input.name,
    role: input.role,
    emails: input.emails,
    phones: input.phones,
    isDecisionMaker: input.isDecisionMaker,
    isPrimary: input.isPrimary,
    relationship: "CLIENT_STAFF",
    sources: await sourcesFor(clientId, input.sources),
  });
  await reachStep(clientId, 3);
  return contact;
}

export async function updateOnboardingContact(actor: User, clientId: string, contactId: string, input: Omit<OnboardingContactInput, "sources">) {
  await onboardingClient(actor, clientId);
  const row = await prisma.clientContact.findFirst({ where: { id: contactId, clientId, deletedAt: null }, include: { person: true } });
  if (!row) throw new DomainError("clientContacts.contactNotFound", "איש הקשר לא נמצא.");
  // The wizard shows one email and one number. The person may have more,
  // from another client's file: only the first, the one shown, changes.
  const firstReplaced = (all: string[], given: string[] | undefined) => (given === undefined ? undefined : [...given.slice(0, 1), ...all.slice(1)]);
  return updateClientContact(actor, contactId, { ...input, emails: firstReplaced(row.person.emails, input.emails), phones: firstReplaced(row.person.phones, input.phones) });
}

export async function removeOnboardingContact(actor: User, clientId: string, contactId: string) {
  await onboardingClient(actor, clientId);
  const row = await prisma.clientContact.findFirst({ where: { id: contactId, clientId, deletedAt: null } });
  if (!row) throw new DomainError("clientContacts.contactNotFound", "איש הקשר לא נמצא.");
  return removeClientContact(actor, contactId);
}

// ---------------------------------------------------------------------------
// Step 4: rules and team
// ---------------------------------------------------------------------------

/// A rule entered in setup is PROPOSED, like any rule someone writes down:
/// a manager approves it. Until then it applies as written (ruleInForce).
export async function addOnboardingRule(actor: User, clientId: string, input: { kind: RuleKindInSetup; title: string; statement: string; sources?: SourceRef[] }) {
  await onboardingClient(actor, clientId);
  if (input.kind !== "DATA_HANDLING" && input.kind !== "DISCLOSURE") {
    throw new DomainError("clientOnboarding.ruleKind", "בהקמה נכנסים כללי טיפול במידע וכללי \"לא לספר\". שאר הכללים נכתבים בתיק אחרי ההפעלה.");
  }
  const rule = await addClientPolicy(actor, { clientId, kind: input.kind, title: input.title, statement: input.statement, sources: await sourcesFor(clientId, input.sources) });
  // A rule answers the question "are there rules?", so the "none" answer goes.
  await prisma.client.update({ where: { id: clientId }, data: { noSpecialRulesAt: null } });
  await reachStep(clientId, 4);
  return rule;
}

export async function removeOnboardingRule(actor: User, clientId: string, ruleId: string) {
  await onboardingClient(actor, clientId);
  const row = await prisma.clientPolicy.findFirst({ where: { id: ruleId, clientId, deletedAt: null } });
  if (!row) throw new DomainError("clientPolicies.notFound", "הכלל לא נמצא.");
  return removeClientPolicy(actor, ruleId);
}

export async function confirmNoSpecialRules(actor: User, clientId: string, confirmed: boolean) {
  await onboardingClient(actor, clientId);
  if (confirmed) {
    const rules = await prisma.clientPolicy.count({ where: { clientId, deletedAt: null, status: { not: "RETIRED" } } });
    if (rules > 0) throw new DomainError("clientOnboarding.hasRules", "ללקוח כבר יש כללים. כדי לסמן שאין, מסירים אותם קודם.");
  }
  await prisma.client.update({ where: { id: clientId }, data: { noSpecialRulesAt: confirmed ? new Date() : null } });
  await recordAudit({ actorId: actor.id, action: "client.no_special_rules", entityType: "Client", entityId: clientId, clientId, after: { confirmed } });
  await reachStep(clientId, 4);
}

export async function setOnboardingTeam(actor: User, clientId: string, input: { accountManagerId: string | null; backupManagerId: string | null }) {
  await onboardingClient(actor, clientId);
  const client = await updateClient(actor, clientId, input);
  await reachStep(clientId, 4);
  return client;
}

// ---------------------------------------------------------------------------
// Reading where a setup stands
// ---------------------------------------------------------------------------

export async function onboardingState(actor: User, clientId: string) {
  const client = await onboardingClient(actor, clientId);
  const [domains, orgs, contacts, rules, sources, users] = await Promise.all([
    prisma.clientDomain.findMany({ where: { clientId, deletedAt: null }, orderBy: { createdAt: "asc" }, include: { organization: { select: { name: true } } } }),
    prisma.clientOrganization.findMany({ where: { clientId, deletedAt: null }, orderBy: { createdAt: "asc" }, include: { organization: true } }),
    prisma.clientContact.findMany({ where: { clientId, deletedAt: null }, orderBy: { createdAt: "asc" }, include: { person: true } }),
    prisma.clientPolicy.findMany({ where: { clientId, deletedAt: null, status: { not: "RETIRED" } }, orderBy: { createdAt: "asc" } }),
    prisma.clientSource.findMany({ where: { clientId, deletedAt: null }, orderBy: { seq: "asc" }, select: { code: true, title: true, kind: true } }),
    prisma.user.findMany({ where: { id: { in: [client.accountManagerId, client.backupManagerId].filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const setupCode = sources.find((s) => s.title === SETUP_SOURCE_TITLE)?.code ?? null;
  const titleOf = new Map(sources.map((s) => [s.code, s.title]));
  /// Where an item came from, when it is not the setup itself: what
  /// Claude, or anyone, cited (the design's "נוסף מקלוד · מקור").
  const otherSource = (refs: unknown): string | null => {
    const other = readSourceRefs(refs).find((r) => r.code !== setupCode);
    return other ? titleOf.get(other.code) ?? other.code : null;
  };
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const contactRows = contacts.map((c) => ({
    id: c.id,
    name: c.person.name,
    role: c.role,
    emails: c.person.emails,
    phones: c.person.phones,
    isPrimary: c.isPrimary,
    isDecisionMaker: c.isDecisionMaker,
    source: otherSource(c.sources),
  }));
  const snapshot = {
    kind: client.kind,
    clientDomains: domains.filter((d) => d.kind === "CLIENT").length,
    contacts: contactRows.map((c) => ({ name: c.name, emails: c.emails.length, phones: c.phones.length })),
    preferredChannel: client.preferredChannel,
    rules: rules.length,
    noSpecialRulesAt: client.noSpecialRulesAt,
    accountManagerId: client.accountManagerId,
    backupManagerId: client.backupManagerId,
  };
  const missing = onboardingMissing(snapshot).map((code: OnboardingRequirement) => ({
    code,
    step: REQUIREMENT_STEP[code],
    text: code === "contactReachable" ? `${REQUIREMENT_TEXT[code]} (${unreachableContacts(snapshot).join(", ")})` : REQUIREMENT_TEXT[code],
  }));
  return {
    id: client.id,
    name: client.name,
    kind: client.kind,
    industry: client.industry,
    timezone: client.timezone,
    communicationLocale: client.communicationLocale,
    aiExcluded: client.aiExcluded,
    step: client.onboardingStep ?? 1,
    preferredChannel: client.preferredChannel,
    whatsappNumber: client.whatsappNumber,
    domains: domains.filter((d) => d.kind === "CLIENT").map((d) => ({ id: d.id, domain: d.domain })),
    partners: orgs.map((o) => ({
      id: o.id,
      name: o.organization.name,
      role: o.role,
      domains: domains.filter((d) => d.kind === "PARTNER" && d.organizationId === o.organizationId).map((d) => d.domain),
      source: otherSource(o.sources),
    })),
    contacts: contactRows,
    rules: rules.map((r) => ({ id: r.id, kind: r.kind, title: r.title, statement: r.statement, status: r.status, source: otherSource(r.sources) })),
    noSpecialRules: client.noSpecialRulesAt !== null,
    accountManager: client.accountManagerId ? { id: client.accountManagerId, name: nameOf.get(client.accountManagerId) ?? null } : null,
    backupManager: client.backupManagerId ? { id: client.backupManagerId, name: nameOf.get(client.backupManagerId) ?? null } : null,
    sources: sources.map((s) => ({ code: s.code, title: s.title, kind: s.kind })),
    missing,
    ready: missing.length === 0,
    updatedAt: client.updatedAt,
  };
}

export type OnboardingState = Awaited<ReturnType<typeof onboardingState>>;

/// The clients being set up, with what each still needs, for the client
/// list's "בהקמה" section and for Claude.
export async function listOnboarding(actor: User) {
  assertCan(actor.role, "client.manage");
  const clients = await prisma.client.findMany({ where: { status: "ONBOARDING", deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  const states = await Promise.all(clients.map((c) => onboardingState(actor, c.id)));
  const lastEditor = await Promise.all(
    clients.map((c) =>
      prisma.auditEvent.findFirst({ where: { clientId: c.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, actor: { select: { name: true } } } }),
    ),
  );
  return states.map((s, i) => ({ ...s, lastEditedAt: lastEditor[i]?.createdAt ?? s.updatedAt, lastEditedBy: lastEditor[i]?.actor?.name ?? null }));
}

/// A source for what Claude, or anyone, adds from somewhere other than the
/// setup itself: an email, a meeting, a document.
export async function addOnboardingSource(actor: User, clientId: string, input: { kind: SourceKind; title: string; occurredAt?: Date | null }) {
  await onboardingClient(actor, clientId);
  const title = input.title?.trim();
  const existing = title ? await prisma.clientSource.findFirst({ where: { clientId, title, kind: input.kind, deletedAt: null } }) : null;
  if (existing) return existing;
  return addClientSource(actor, { clientId, kind: input.kind, title: input.title, occurredAt: input.occurredAt ?? null });
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/// The client leaves setup: what the automation needs is checked, the
/// account manager and the backup get access, and from now on the
/// extraction, the agents, WhatsApp and calls and the timer see it. On the
/// summary screen only (Ariel, 26.11.2026): no connector tool calls this.
export async function activateOnboardingClient(actor: User, clientId: string) {
  const state = await onboardingState(actor, clientId);
  if (!state.ready) {
    throw new DomainError("clientOnboarding.notReady", `עוד חסר להפעלה: ${state.missing.map((m) => m.text).join("; ")}.`, { missing: state.missing.map((m) => m.text).join("; ") });
  }
  const now = new Date();
  const client = await prisma.client.update({ where: { id: clientId }, data: { status: "ACTIVE", onboardingStep: null, activatedAt: now } });
  for (const userId of [state.accountManager!.id, state.backupManager!.id]) {
    await prisma.userClientAccess.upsert({ where: { userId_clientId: { userId, clientId } }, update: {}, create: { userId, clientId } });
  }
  await recordAudit({ actorId: actor.id, action: "client.activate", entityType: "Client", entityId: clientId, clientId, after: { status: "ACTIVE", activatedAt: now } });
  return client;
}
