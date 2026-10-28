import "server-only";
import type { User } from "@prisma/client";
import { FACT_KIND_LABELS } from "@/lib/client-facts";
import { SOURCE_KIND_LABELS } from "@/lib/knowledge-sources";
import { buildExtractPrompt } from "@/lib/extract-prompt";
import { listClientSources, listClientDomains } from "@/lib/app-domain/client-sources";
import { listClientPeople } from "@/lib/app-domain/client-contacts";
import { listClientFacts } from "@/lib/app-domain/client-facts";
import { listSystemMap } from "@/lib/app-domain/system-map";
import { listRequestTypes } from "@/lib/app-domain/request-types";
import { currentGuide } from "@/lib/app-domain/extraction-guide";
import { listClientPolicies } from "@/lib/app-domain/client-policies";
import { ruleLine } from "@/lib/client-policies";
import { prisma } from "@/lib/prisma";
import { canSendToAi, type KnowledgeAudienceLike } from "@/lib/knowledge";

// The input to "חלץ ידע עם קלוד" (lib/extract-prompt.ts). Gathered through
// the file's own list functions, so each item's audience applies, and in
// the version for Claude: names only, no contact details, nothing
// sensitive, nothing restricted to others (spec 6.3). A pasted prompt leaves the product.

/// 28.10.2026: null for a client marked "בלי AI". Nothing of theirs goes
/// into a prompt, so there is nothing to extract with Claude.
export async function extractPromptFor(actor: User, clientId: string): Promise<string | null> {
  const flag = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { aiExcluded: true } });
  if (flag.aiExcluded) return null;
  const [client, facts, people, systems, sources, domains, requestTypes, guide, policies] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true } }),
    listClientFacts(actor, clientId),
    listClientPeople(actor, clientId),
    listSystemMap(actor, clientId),
    listClientSources(actor, clientId),
    listClientDomains(actor, clientId),
    listRequestTypes(actor, clientId),
    currentGuide(),
    listClientPolicies(actor, clientId),
  ]);
  const shown = <T extends { sensitivity: string; audience: KnowledgeAudienceLike; audienceUserIds: string[] }>(rows: T[]) =>
    rows.filter((r) => canSendToAi(r, actor.id));
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const short = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}...` : s);

  return buildExtractPrompt({
    requestedBy: actor.name,
    clientName: client.name,
    facts: shown(facts.current)
      .filter((f) => !(f.kind === "QUESTION" && f.answeredAt) && !(f.kind === "TEMPORARY" && f.closedAt))
      .map((f) => ({ id: f.id, label: FACT_KIND_LABELS[f.kind], text: short(f.body) })),
    people: shown(people.contacts).map((c) => [c.person.name, c.role].filter(Boolean).join(", ")),
    organizations: shown(people.organizations).map((o) => o.organization.name),
    systems: shown(systems).map((s) => s.systemName),
    requestTypes: shown(requestTypes).map((r) => r.title),
    // Rules a meeting may bring up again: by title, so a repeat is not proposed.
    policies: shown(policies).filter((p) => p.status !== "RETIRED").map((p) => p.title),
    dataHandling: policies
      .filter((p) => p.kind === "DATA_HANDLING")
      .map(ruleLine)
      .filter((l): l is string => !!l),
    sources: sources.map((s) => ({
      code: s.code,
      title: s.title,
      dateLabel: day(s.occurredAt),
      kindLabel: SOURCE_KIND_LABELS[s.kind],
      firefliesId: Array.isArray(s.externalRefs) ? ((s.externalRefs as { system?: string; id?: string }[]).find((r) => r?.system === "FIREFLIES")?.id ?? null) : null,
      topicsOnly: s.restriction === "TOPICS_ONLY",
    })),
    domains: domains.map((d) => d.domain),
    guide,
  });
}
