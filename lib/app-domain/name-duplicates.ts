import "server-only";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { dateDuplicatePairs, dateKeyFromRow, duplicatePairs, type DateCandidate, type DuplicatePair, type NameCandidate } from "@/lib/name-match";

// Items with a name that may be in the file twice under two spellings
// (lib/name-match.ts): people, organizations, systems and legal entities.
// The proposal flags read the file through here, and so does the cleanup
// list on the client page.

export const NAMED_TARGETS = ["CONTACT", "ORGANIZATION", "SYSTEM", "ENTITY"] as const;
export type NamedTarget = (typeof NAMED_TARGETS)[number];

export function isNamedTarget(target: string): target is NamedTarget {
  return (NAMED_TARGETS as readonly string[]).includes(target);
}

/// The payload field that names the item.
export function nameFieldOf(target: NamedTarget): "name" | "systemName" {
  return target === "SYSTEM" ? "systemName" : "name";
}

export const NAMED_LABELS: Record<NamedTarget, string> = {
  CONTACT: "אנשי קשר",
  ORGANIZATION: "ארגונים",
  SYSTEM: "מערכות",
  ENTITY: "ישויות",
};

/// The client's items of this kind, by name, as they are in the file now.
export async function namesInFile(clientId: string, target: NamedTarget): Promise<NameCandidate[]> {
  const live = { clientId, deletedAt: null };
  if (target === "CONTACT") {
    const rows = await prisma.clientContact.findMany({ where: live, select: { id: true, person: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
    return rows.filter((r) => r.person.name).map((r) => ({ id: r.id, name: r.person.name! }));
  }
  if (target === "ORGANIZATION") {
    const rows = await prisma.clientOrganization.findMany({ where: live, select: { id: true, organization: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ id: r.id, name: r.organization.name }));
  }
  if (target === "SYSTEM") {
    const rows = await prisma.systemAccess.findMany({ where: live, select: { id: true, systemName: true }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ id: r.id, name: r.systemName }));
  }
  const rows = await prisma.clientEntity.findMany({ where: live, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/// The client's own dates (not the holidays every client gets), with when
/// each falls: two rows for one birthday are the same date only when they
/// also fall on the same day (lib/name-match.ts, datesMatch).
export async function datesInFile(clientId: string): Promise<DateCandidate[]> {
  const rows = await prisma.importantDate.findMany({
    where: { clientId, deletedAt: null, holidayKey: null, status: { not: "ARCHIVED" } },
    select: { id: true, title: true, recurrence: true, calendarType: true, month: true, day: true, weekday: true, onceDate: true, nextOccurrenceAt: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.title, key: dateKeyFromRow(r) }));
}

/// What may already be twice in the file: the cleanup list.
export async function possibleDuplicates(actor: User, clientId: string): Promise<DuplicatePair<NamedTarget | "DATE">[]> {
  await assertClientAccess(actor, clientId);
  const out: DuplicatePair<NamedTarget | "DATE">[] = [];
  for (const t of NAMED_TARGETS) out.push(...duplicatePairs(t, await namesInFile(clientId, t)));
  out.push(...dateDuplicatePairs("DATE" as const, await datesInFile(clientId)));
  return out;
}

/// The list fields a merge adds to, rather than replaces: what the item
/// already has stays.
export async function listsOf(target: NamedTarget, id: string): Promise<Record<string, string[]>> {
  if (target === "CONTACT") {
    const c = await prisma.clientContact.findUnique({ where: { id }, select: { person: { select: { emails: true, phones: true } } } });
    return c ? { emails: c.person.emails, phones: c.person.phones } : {};
  }
  if (target === "ORGANIZATION") {
    const o = await prisma.clientOrganization.findUnique({ where: { id }, select: { organization: { select: { domains: true } } } });
    return o ? { domains: o.organization.domains } : {};
  }
  return {};
}
