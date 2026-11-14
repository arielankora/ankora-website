import "server-only";
import { NO_AI_MEETING_MARKER } from "@/lib/ai-exclusion";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import { assertCan } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { currentGuide } from "@/lib/app-domain/extraction-guide";
import { DEFAULT_EXTRACTION_GUIDE_LINES, guideLines } from "@/lib/extract-prompt";
import { policiesInForce } from "@/lib/app-domain/client-policies";
import { ruleLine } from "@/lib/client-policies";
import { processedComms } from "@/lib/comms/extraction-refs";

// Org brain, phase 2: what an unattended extraction needs before it reads
// a single meeting (claude/org-brain-spec-2026-10-12.md, 5.1).
//
// The daily run happens in a scheduled Claude session nobody watches. Its
// prompt stays short and stable; everything that changes lives here and
// is read on each run: the approved guidance (decision 3), the clients
// this person can reach with the domains that tell their meetings apart,
// and the recordings already turned into proposals, so a meeting is never
// proposed twice.
//
// Domains, never addresses: matching a meeting to a client needs only the
// part after the "@", and the run has no business with anyone's address.

const PROCESSED_WINDOW_DAYS = 30;

export async function extractionBrief(actor: User, now = new Date()) {
  assertCan(actor.role, "time_entry.create_self");
  const clients = await listAccessibleClients(actor);
  const ids = clients.map((c) => c.id);
  const since = new Date(now.getTime() - PROCESSED_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [guide, domains, sources, rules] = await Promise.all([
    currentGuide(),
    prisma.clientDomain.findMany({
      where: { clientId: { in: ids }, deletedAt: null },
      select: { clientId: true, domain: true, kind: true, organization: { select: { name: true } } },
    }),
    prisma.clientSource.findMany({
      where: { clientId: { in: ids }, deletedAt: null, createdAt: { gte: since } },
      select: { clientId: true, code: true, title: true, externalRefs: true, createdAt: true },
    }),
    // Each client's own rules about what may enter its file (spec 3.11,
    // DATA_HANDLING): the run applies them to that client's meetings only.
    policiesInForce(actor, clients, ["DATA_HANDLING"]),
  ]);
  // 14.11.2026: what was already read of stored WhatsApp conversations and
  // recorded calls, from the sources registered for them (all time: a
  // conversation goes on, and the next run starts the day after).
  const commsSources = await prisma.clientSource.findMany({
    where: { clientId: { in: ids }, deletedAt: null, kind: { in: ["PERSON", "TRANSCRIPT"] } },
    select: { clientId: true, externalRefs: true },
  });

  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  const marked = new Set(clients.filter((c) => c.aiExcluded).map((c) => c.id));
  const processed = sources.filter((s) => !marked.has(s.clientId)).flatMap((s) =>
    (Array.isArray(s.externalRefs) ? (s.externalRefs as { system?: string; id?: string }[]) : [])
      .filter((r) => r?.system === "FIREFLIES" && r.id)
      .map((r) => ({ firefliesId: r.id!, client: nameOf.get(s.clientId) ?? "", sourceCode: s.code, title: s.title }))
  );

  return {
    guide: {
      version: guide?.version ?? null,
      rules: guide ? guideLines(guide.body) : DEFAULT_EXTRACTION_GUIDE_LINES,
    },
    // 28.10.2026: a client marked "בלי AI" stays on the list, by name and
    // domains only, so a run can recognise its meetings and leave them
    // unopened. Dropping it would let one of its recordings pass for
    // internal or for another client's.
    clients: clients
      .filter((c) => !c.isInternal)
      .map((c) => c.aiExcluded ? {
        name: c.name,
        aiExcluded: true as const,
        instruction: 'Marked "בלי AI": skip every meeting of this client. Do not open its transcript or summary, and propose nothing from it.',
        domains: domains
          .filter((d) => d.clientId === c.id)
          .map((d) => ({ domain: d.domain, kind: d.kind, organization: d.organization?.name ?? null })),
      } : {
        name: c.name,
        domains: domains
          .filter((d) => d.clientId === c.id)
          .map((d) => ({ domain: d.domain, kind: d.kind, organization: d.organization?.name ?? null })),
        dataHandlingRules: rules
          .filter((r) => r.clientId === c.id)
          .map(ruleLine)
          .filter((l): l is string => !!l),
      }),
    // 28.10.2026: a meeting where a "בלי AI" subject came up is marked in
    // its title by whoever ran it, and a run leaves it unopened.
    noAiMeetings: {
      titleMarker: NO_AI_MEETING_MARKER,
      instruction: `Skip any meeting whose title contains "${NO_AI_MEETING_MARKER}": a subject marked "בלי AI" came up in it. Do not open its transcript or summary, and propose nothing from it.`,
    },
    processedRecordings: processed,
    processedWindowDays: PROCESSED_WINDOW_DAYS,
    communications: communicationsBrief(clients, nameOf, marked, commsSources),
  };
}

/// The stored WhatsApp conversations and recorded calls (14.11.2026): what
/// was already read, per client, and how to read the rest.
function communicationsBrief(
  clients: { id: string; isInternal?: boolean }[],
  nameOf: Map<string, string>,
  marked: Set<string>,
  sources: { clientId: string; externalRefs: unknown }[],
) {
  const byClient = new Map<string, { system?: unknown; id?: unknown }[]>();
  for (const s of sources) {
    if (marked.has(s.clientId) || !Array.isArray(s.externalRefs)) continue;
    byClient.set(s.clientId, [...(byClient.get(s.clientId) ?? []), ...(s.externalRefs as { system?: unknown; id?: unknown }[])]);
  }
  const alreadyRead = [];
  for (const c of clients) {
    const refs = byClient.get(c.id);
    if (!refs) continue;
    const p = processedComms(refs);
    if (p.whatsappReadThrough.size === 0 && p.calls.size === 0) continue;
    alreadyRead.push({
      client: nameOf.get(c.id) ?? "",
      whatsapp: [...p.whatsappReadThrough].map(([conversationId, readThrough]) => ({ conversationId, readThrough })),
      calls: [...p.calls],
    });
  }
  return {
    instruction: [
      "Ankora also keeps its WhatsApp conversations and recorded phone calls with clients. For a client, list_client_communications lists them and get_client_communication reads one.",
      "A conversation is read from the day after its `readThrough` below (all of it when it has none), and each stretch read is one source: newSource of kind PERSON with `whatsapp` {conversationId, from, to}, `to` being the last day read. A recorded call whose id is under `calls` below was already read; any other is one source: newSource of kind TRANSCRIPT with `callId`. Read a call only when its transcript is ready.",
      "Only what the client's people wrote or said is the client's word: Ankora's own messages give context, and an item they alone support is UNCERTAIN. Leave out greetings, scheduling and small talk. The client's dataHandlingRules apply as to meetings.",
    ].join(" "),
    alreadyRead,
  };
}
