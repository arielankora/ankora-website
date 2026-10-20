import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeDomain, normalizeEmail, normalizePhone } from "@/lib/contact-normalize";
import { normalizeForMatch, type ProposalFlag } from "@/lib/knowledge-proposals";
import { currentItem } from "@/lib/app-domain/proposal-updates";

// "Already in the file", asked now and not when the proposal arrived
// (20.10.2026).
//
// The check used to run once, when Claude sent the proposal. An item that
// entered the file after that, from another meeting or by hand, left the
// proposal looking new: the card offered "אישור", and the file's own
// function refused it ("IBI כבר בתיק של הלקוח") with nothing to do next.
//
// So the same question is asked when the card is read and when a person
// decides, with the rules the file's own functions use to refuse a second
// copy: an organization by domain or name, a contact by email or phone, a
// system by name and account. Where the file only warns (a fact with the
// same text, a process or rule with the same title), the warning follows
// the same match.
//
// Only a proposal that adds something new is asked. A change to an item
// is about that item: "already in the file" is the point.

export type ExistingItem = { id: string; body: string };

const DUPLICATE_MESSAGES: Record<string, string> = {
  FACT: "אותו פריט כבר קיים בתיק.",
  CONTACT: "איש קשר עם המייל או הטלפון הזה כבר בתיק.",
  ORGANIZATION: "הארגון כבר בתיק.",
  SYSTEM: "המערכת, באותו חשבון, כבר במפת המערכות.",
  ENTITY: "ישות בשם הזה כבר בתיק.",
  PROCESS: "תהליך בשם הזה כבר בתיק.",
  DATE: "מועד בשם הזה כבר אצל הלקוח.",
  DOMAIN: "הדומיין כבר בתיק.",
  POLICY: "כלל עם אותו שם או אותו נוסח כבר בתיק.",
};

export function duplicateFlag(target: string): ProposalFlag {
  return { code: "DUPLICATE", message: DUPLICATE_MESSAGES[target] ?? "הפריט כבר בתיק." };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown, clean: (s: string) => string | null) =>
  (Array.isArray(v) ? v : []).map((x) => (typeof x === "string" ? clean(x) : null)).filter((x): x is string => !!x);

/// The item in this client's file that a new proposal would copy, or null.
export async function findExisting(clientId: string, target: string, action: string, payload: Record<string, unknown>): Promise<ExistingItem | null> {
  if (action !== "CREATE") return null;
  const live = { clientId, deletedAt: null };

  if (target === "ORGANIZATION") {
    // As findOrCreateOrganization finds it: a domain first, then the name.
    const domains = list(payload.domains, normalizeDomain);
    const name = str(payload.name);
    const or = [...(domains.length ? [{ organization: { domains: { hasSome: domains } } }] : []), ...(name ? [{ organization: { name: { equals: name, mode: "insensitive" as const } } }] : [])];
    if (!or.length) return null;
    const row = await prisma.clientOrganization.findFirst({ where: { ...live, organization: { deletedAt: null }, OR: or }, select: { id: true } });
    return row ? currentItem(clientId, target, row.id) : null;
  }
  if (target === "CONTACT") {
    // As findOrCreatePerson finds the person: an email, then a phone. Two
    // people with the same name are two people.
    const emails = list(payload.emails, normalizeEmail);
    const phones = list(payload.phones, normalizePhone);
    const or = [...(emails.length ? [{ person: { emails: { hasSome: emails } } }] : []), ...(phones.length ? [{ person: { phones: { hasSome: phones } } }] : [])];
    if (!or.length) return null;
    const row = await prisma.clientContact.findFirst({ where: { ...live, OR: or }, select: { id: true } });
    return row ? currentItem(clientId, target, row.id) : null;
  }
  if (target === "SYSTEM") {
    // As addSystemAccess refuses it: the same system in the same account.
    const systemName = str(payload.systemName);
    if (!systemName) return null;
    const account = str(payload.accountUsed);
    const row = await prisma.systemAccess.findFirst({
      where: { ...live, systemName: { equals: systemName, mode: "insensitive" }, accountUsed: account ? { equals: account, mode: "insensitive" } : null },
      select: { id: true },
    });
    return row ? currentItem(clientId, target, row.id) : null;
  }
  if (target === "ENTITY") {
    const name = str(payload.name);
    if (!name) return null;
    const row = await prisma.clientEntity.findFirst({ where: { ...live, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    return row ? currentItem(clientId, target, row.id) : null;
  }
  if (target === "PROCESS") {
    const title = normalizeForMatch(str(payload.title));
    if (!title) return null;
    const rows = await prisma.process.findMany({ where: { ...live, status: { not: "RETIRED" } }, select: { id: true, title: true } });
    const row = rows.find((r) => normalizeForMatch(r.title) === title);
    return row ? currentItem(clientId, target, row.id) : null;
  }
  if (target === "POLICY") {
    const title = normalizeForMatch(str(payload.title));
    const statement = normalizeForMatch(str(payload.statement));
    const rows = await prisma.clientPolicy.findMany({ where: { ...live, status: { not: "RETIRED" } }, select: { id: true, title: true, statement: true } });
    const row = rows.find((r) => (statement && normalizeForMatch(r.statement) === statement) || (title && normalizeForMatch(r.title) === title));
    return row ? currentItem(clientId, target, row.id) : null;
  }
  if (target === "FACT") {
    const body = normalizeForMatch(str(payload.body));
    if (!body) return null;
    const rows = await prisma.clientFact.findMany({
      where: { ...live, knowledgeStatus: { not: "SUPERSEDED" }, kind: payload.kind as never },
      select: { id: true, body: true },
    });
    const row = rows.find((r) => normalizeForMatch(r.body) === body);
    return row ? { id: row.id, body: row.body } : null;
  }
  if (target === "DATE") {
    const title = normalizeForMatch(str(payload.title));
    if (!title) return null;
    const rows = await prisma.importantDate.findMany({ where: { ...live, status: { not: "ARCHIVED" }, holidayKey: null }, select: { id: true, title: true } });
    const row = rows.find((r) => normalizeForMatch(r.title) === title);
    return row ? { id: row.id, body: row.title } : null;
  }
  if (target === "DOMAIN") {
    const domain = normalizeDomain(str(payload.domain));
    if (!domain) return null;
    const row = await prisma.clientDomain.findFirst({ where: { ...live, domain }, select: { id: true, domain: true } });
    return row ? { id: row.id, body: row.domain } : null;
  }
  return null;
}

/// The flags as they stand now: the "already in the file" warning from
/// when the proposal arrived is dropped, and asked again.
export function withLiveDuplicate<T extends { code: string }>(flags: T[], target: string, existing: ExistingItem | null): (T | ProposalFlag)[] {
  const rest = flags.filter((f) => f.code !== "DUPLICATE");
  return existing ? [...rest, duplicateFlag(target)] : rest;
}

/// Kinds whose items keep sources: "כבר בתיק" adds the proposal's sources
/// to the item. A date or a domain keeps none, so it only closes.
export const KEEPS_SOURCES = ["FACT", "CONTACT", "ORGANIZATION", "SYSTEM", "ENTITY", "PROCESS", "POLICY"] as const;

export function keepsSources(target: string): boolean {
  return (KEEPS_SOURCES as readonly string[]).includes(target);
}
