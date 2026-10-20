import "server-only";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import { canSendToAi } from "@/lib/knowledge";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { briefMarkdown, changesMarkdown, type RemovedItem } from "@/lib/client-file-live";

// The client file, live, for Claude (claude/client-file-live-2026-10-20.md).
// The file stays in Ankora; Claude reads it when it works. These two cut
// the same document the full file is, for Claude ("ai"): the access check,
// the audience and the sensitivity rules are buildClientFile's own.

export async function clientBrief(actor: User, clientId: string): Promise<string> {
  return briefMarkdown(await buildClientFile(actor, clientId, { audience: "ai" }));
}

export async function clientFileChanges(actor: User, clientId: string, since: Date, now = new Date()): Promise<string> {
  // First: it checks the actor may reach the client.
  const doc = await buildClientFile(actor, clientId, { audience: "ai" });
  const changedSince = { clientId, updatedAt: { gte: since } };
  const id = { id: true } as const;
  const visible = { sensitivity: true, audience: true, audienceUserIds: true } as const;
  const gone = { clientId, deletedAt: { gte: since } };

  const [facts, contacts, orgs, systems, entities, requests, policies, processes, versions, dates, narratives] = await Promise.all([
    prisma.clientFact.findMany({ where: changedSince, select: id }),
    prisma.clientContact.findMany({ where: changedSince, select: id }),
    prisma.clientOrganization.findMany({ where: changedSince, select: id }),
    prisma.systemAccess.findMany({ where: changedSince, select: id }),
    prisma.clientEntity.findMany({ where: changedSince, select: id }),
    prisma.requestType.findMany({ where: changedSince, select: id }),
    prisma.clientPolicy.findMany({ where: changedSince, select: id }),
    prisma.process.findMany({ where: changedSince, select: id }),
    prisma.processVersion.findMany({ where: { process: { clientId }, OR: [{ createdAt: { gte: since } }, { approvedAt: { gte: since } }] }, select: { processId: true } }),
    prisma.importantDate.findMany({ where: changedSince, select: id }),
    prisma.clientNarrative.count({ where: { clientId, createdAt: { gte: since } } }),
  ]);
  const changed = new Set([...facts, ...contacts, ...orgs, ...systems, ...entities, ...requests, ...policies, ...processes, ...dates].map((r) => r.id));
  for (const v of versions) changed.add(v.processId);

  // What left the file, named only when it may be sent to Claude at all.
  const [goneFacts, replacedFacts, goneContacts, goneOrgs, goneSystems, goneEntities, goneRequests, gonePolicies, retiredPolicies, goneProcesses] = await Promise.all([
    prisma.clientFact.findMany({ where: gone, select: { body: true, ...visible } }),
    prisma.clientFact.findMany({ where: { ...changedSince, deletedAt: null, knowledgeStatus: "SUPERSEDED" }, select: { body: true, ...visible } }),
    prisma.clientContact.findMany({ where: gone, select: { role: true, person: { select: { name: true } }, ...visible } }),
    prisma.clientOrganization.findMany({ where: gone, select: { organization: { select: { name: true } }, ...visible } }),
    prisma.systemAccess.findMany({ where: gone, select: { systemName: true, ...visible } }),
    prisma.clientEntity.findMany({ where: gone, select: { name: true, ...visible } }),
    prisma.requestType.findMany({ where: gone, select: { title: true, ...visible } }),
    prisma.clientPolicy.findMany({ where: gone, select: { title: true, ...visible } }),
    prisma.clientPolicy.findMany({ where: { ...changedSince, deletedAt: null, status: "RETIRED" }, select: { title: true, ...visible } }),
    prisma.process.findMany({ where: { ...gone }, select: { code: true, title: true, ...visible } }),
  ]);
  const ok = <T extends { sensitivity: string; audience: never | string; audienceUserIds: string[] }>(rows: T[]) => rows.filter((r) => canSendToAi(r as never, actor.id));
  const removed: RemovedItem[] = [
    ...ok(goneFacts).map((r) => ({ label: "עובדה", text: r.body, how: "removed" as const })),
    ...ok(replacedFacts).map((r) => ({ label: "עובדה", text: r.body, how: "replaced" as const })),
    ...ok(goneContacts).map((r) => ({ label: "איש קשר", text: r.person.name ?? r.role ?? "", how: "removed" as const })),
    ...ok(goneOrgs).map((r) => ({ label: "ארגון", text: r.organization.name, how: "removed" as const })),
    ...ok(goneSystems).map((r) => ({ label: "מערכת", text: r.systemName, how: "removed" as const })),
    ...ok(goneEntities).map((r) => ({ label: "ישות", text: r.name, how: "removed" as const })),
    ...ok(goneRequests).map((r) => ({ label: "סוג פנייה", text: r.title, how: "removed" as const })),
    ...ok(gonePolicies).map((r) => ({ label: "כלל", text: r.title, how: "removed" as const })),
    ...ok(retiredPolicies).map((r) => ({ label: "כלל", text: r.title, how: "retired" as const })),
    ...ok(goneProcesses).map((r) => ({ label: "תהליך", text: `${r.code} ${r.title}`, how: "removed" as const })),
  ];
  return changesMarkdown(doc, { since, changed, narrativesChanged: narratives > 0, removed, now });
}
