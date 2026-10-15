import "server-only";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import { assertCan } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { currentGuide } from "@/lib/app-domain/extraction-guide";
import { DEFAULT_EXTRACTION_GUIDE_LINES, guideLines } from "@/lib/extract-prompt";
import { policiesInForce } from "@/lib/app-domain/client-policies";
import { ruleLine } from "@/lib/client-policies";

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

  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  const processed = sources.flatMap((s) =>
    (Array.isArray(s.externalRefs) ? (s.externalRefs as { system?: string; id?: string }[]) : [])
      .filter((r) => r?.system === "FIREFLIES" && r.id)
      .map((r) => ({ firefliesId: r.id!, client: nameOf.get(s.clientId) ?? "", sourceCode: s.code, title: s.title }))
  );

  return {
    guide: {
      version: guide?.version ?? null,
      rules: guide ? guideLines(guide.body) : DEFAULT_EXTRACTION_GUIDE_LINES,
    },
    clients: clients
      .filter((c) => !c.isInternal)
      .map((c) => ({
        name: c.name,
        domains: domains
          .filter((d) => d.clientId === c.id)
          .map((d) => ({ domain: d.domain, kind: d.kind, organization: d.organization?.name ?? null })),
        dataHandlingRules: rules
          .filter((r) => r.clientId === c.id)
          .map(ruleLine)
          .filter((l): l is string => !!l),
      })),
    processedRecordings: processed,
    processedWindowDays: PROCESSED_WINDOW_DAYS,
  };
}
