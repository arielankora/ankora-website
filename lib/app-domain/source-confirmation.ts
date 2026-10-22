import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { SECONDARY_ONLY_TO_RESOLVE, readSourceRefs, uncertainOnlyForAnkora } from "@/lib/knowledge-sources";

// "אושר מול הלקוח" on one source (21.10.2026). Grantor's file had twelve
// items marked uncertain only because their source was Ankora's own
// document: the intake file Hadas wrote while Nadav talked. They were
// what the client said, and the mark hid the items that really needed
// checking. A manager confirms them in one step, with a line of how it
// was confirmed, and the source is marked as a summary of a conversation
// with the client, so what comes from it next is not lowered again.
//
// Only items lowered by R14 and nothing else are touched: their
// "what would close it" is exactly the R14 sentence. Nothing changes
// until a manager asks for it.

const where = (clientIds: string[]) => ({ clientId: { in: clientIds }, deletedAt: null, knowledgeStatus: "UNCERTAIN" as const, toResolve: SECONDARY_ONLY_TO_RESOLVE });
const pick = { id: true, clientId: true, knowledgeStatus: true, toResolve: true, sources: true } as const;

type Row = { id: string; clientId: string; knowledgeStatus: string; toResolve: string | null; sources: unknown };
type Table = "fact" | "contact" | "organization" | "system" | "entity" | "requestType" | "policy" | "process";

async function lowered(clientIds: string[]): Promise<{ table: Table; row: Row }[]> {
  if (clientIds.length === 0) return [];
  const w = where(clientIds);
  const [facts, contacts, orgs, systems, entities, requestTypes, policies, processes] = await Promise.all([
    prisma.clientFact.findMany({ where: w, select: pick }),
    prisma.clientContact.findMany({ where: w, select: pick }),
    prisma.clientOrganization.findMany({ where: w, select: pick }),
    prisma.systemAccess.findMany({ where: w, select: pick }),
    prisma.clientEntity.findMany({ where: w, select: pick }),
    prisma.requestType.findMany({ where: w, select: pick }),
    prisma.clientPolicy.findMany({ where: { ...w, status: { not: "RETIRED" } }, select: pick }),
    prisma.process.findMany({ where: { ...w, status: { not: "RETIRED" } }, select: pick }),
  ]);
  const tag = (table: Table, rows: Row[]) => rows.map((row) => ({ table, row }));
  return [
    ...tag("fact", facts),
    ...tag("contact", contacts),
    ...tag("organization", orgs),
    ...tag("system", systems),
    ...tag("entity", entities),
    ...tag("requestType", requestTypes),
    ...tag("policy", policies),
    ...tag("process", processes),
  ];
}

export type LoweredSource = { clientId: string; code: string; title: string; count: number };

/// Per client and source: how many items are uncertain only because the
/// source is Ankora's. For the sources panel and "לבדיקה".
export async function loweredBySource(clientIds: string[]): Promise<LoweredSource[]> {
  const rows = await lowered(clientIds);
  const counts = new Map<string, number>();
  for (const { row } of rows) {
    for (const code of new Set(readSourceRefs(row.sources).map((r) => r.code))) {
      const k = `${row.clientId}|${code}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return [];
  const sources = await prisma.clientSource.findMany({ where: { clientId: { in: clientIds }, deletedAt: null, weight: "SECONDARY" }, select: { clientId: true, code: true, title: true } });
  return sources
    .filter((s) => counts.has(`${s.clientId}|${s.code}`))
    .map((s) => ({ clientId: s.clientId, code: s.code, title: s.title, count: counts.get(`${s.clientId}|${s.code}`)! }));
}

/// Confirms, with the client, every item lowered only because of this
/// source, and marks the source a summary of a conversation with the
/// client. Manager only. `note`: how it was confirmed, in one line.
export async function confirmSourceWithClient(actor: User, clientId: string, code: string, note: string): Promise<{ confirmed: number }> {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל מאשר פריטים מול הלקוח בבת אחת.");
  await assertClientAccess(actor, clientId);
  const how = note.trim();
  if (!how) throw new Error("צריך לכתוב בשורה אחת איך זה אושר מול הלקוח.");
  const source = await prisma.clientSource.findFirst({ where: { clientId, code, deletedAt: null } });
  if (!source) throw new Error("המקור לא נמצא במרשם.");
  const rows = (await lowered([clientId])).filter(({ row }) => uncertainOnlyForAnkora(row, code));
  const data = { knowledgeStatus: "CONFIRMED" as const, toResolve: null };
  const byTable = (t: Table) => rows.filter((r) => r.table === t).map((r) => r.row.id);
  await prisma.$transaction([
    prisma.clientFact.updateMany({ where: { id: { in: byTable("fact") } }, data }),
    prisma.clientContact.updateMany({ where: { id: { in: byTable("contact") } }, data }),
    prisma.clientOrganization.updateMany({ where: { id: { in: byTable("organization") } }, data }),
    prisma.systemAccess.updateMany({ where: { id: { in: byTable("system") } }, data }),
    prisma.clientEntity.updateMany({ where: { id: { in: byTable("entity") } }, data }),
    prisma.requestType.updateMany({ where: { id: { in: byTable("requestType") } }, data }),
    prisma.clientPolicy.updateMany({ where: { id: { in: byTable("policy") } }, data }),
    prisma.process.updateMany({ where: { id: { in: byTable("process") } }, data }),
    prisma.clientSource.update({ where: { id: source.id }, data: { weight: "PRIMARY" } }),
  ]);
  await recordAudit({
    actorId: actor.id,
    action: "client_source.confirm_with_client",
    entityType: "ClientSource",
    entityId: source.id,
    clientId,
    before: { code, weight: source.weight },
    after: { code, weight: "PRIMARY", note: how, confirmed: rows.length, items: rows.map((r) => ({ table: r.table, id: r.row.id })) },
  });
  return { confirmed: rows.length };
}
