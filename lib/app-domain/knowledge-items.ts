import "server-only";
import { clientVisibleBlocker, parseFieldStatus, type FieldStatusMap } from "@/lib/knowledge";
import { prisma } from "@/lib/prisma";
import { readSourceRefs, type SourceRef } from "@/lib/knowledge-sources";
import { resolveItemSources } from "@/lib/app-domain/client-sources";
import type { KnowledgeStatus, KnowledgeAudience, KnowledgeSensitivity, KnowledgeImportance, Prisma } from "@prisma/client";

// The knowledge fields every item in a client's file carries (spec 3.1),
// written the same way for every kind of item: people, organizations,
// systems, and what comes next. One place, so the rules cannot drift
// between screens.

export interface KnowledgeInput {
  knowledgeStatus?: KnowledgeStatus;
  fieldStatus?: FieldStatusMap;
  toResolve?: string | null;
  importance?: KnowledgeImportance;
  audience?: KnowledgeAudience;
  audienceUserIds?: string[];
  doNotDisclose?: string | null;
  sensitivity?: KnowledgeSensitivity;
  /// Codes in the client's source register (spec 3.2). Required unless
  /// the item is "missing".
  sources?: SourceRef[];
  /// Spec 3.1: shown to the client in the portal. Off unless a person turns
  /// it on, and never for what is sensitive, restricted or not to be told.
  clientVisible?: boolean;
  /// Spec 3.1: the person at Ankora who keeps the item right. A process's
  /// owner is the same field.
  ownerId?: string | null;
}

export function knowledgeData(input: KnowledgeInput) {
  return {
    knowledgeStatus: input.knowledgeStatus ?? undefined,
    fieldStatus: input.fieldStatus !== undefined ? (parseFieldStatus(input.fieldStatus) as Prisma.InputJsonValue) : undefined,
    toResolve: input.toResolve !== undefined ? input.toResolve?.trim() || null : undefined,
    importance: input.importance ?? undefined,
    audience: input.audience ?? undefined,
    audienceUserIds: input.audienceUserIds ?? undefined,
    doNotDisclose: input.doNotDisclose !== undefined ? input.doNotDisclose?.trim() || null : undefined,
    sensitivity: input.sensitivity ?? undefined,
  };
}

/// The source rules (lib/knowledge-sources.ts) for an item about to be
/// written, merged with what is already stored. Returns the fields to
/// write: sources, and status and toResolve as the rules leave them.
export async function sourcedFields(
  clientId: string,
  input: KnowledgeInput,
  texts: (string | null | undefined)[],
  before?: Before
) {
  const resolved = await resolveItemSources(clientId, {
    status: input.knowledgeStatus ?? before?.knowledgeStatus ?? "CONFIRMED",
    refs: input.sources ?? readSourceRefs(before?.sources),
    toResolve: input.toResolve !== undefined ? input.toResolve?.trim() || null : before?.toResolve ?? null,
    texts,
  });
  return {
    sources: resolved.sources as Prisma.InputJsonValue,
    knowledgeStatus: resolved.knowledgeStatus,
    toResolve: resolved.toResolve,
    ...(await visibilityAndOwner(input, before)),
  };
}

type Before = { knowledgeStatus: KnowledgeStatus; sources: unknown; toResolve: string | null; clientVisible?: boolean; sensitivity?: string; audience?: KnowledgeAudience; doNotDisclose?: string | null };

/// Spec 3.1: who keeps the item, and whether the client may see it. Only
/// the keys that change are returned: a key left out is left as it is (a
/// process's owner is written by its own form).
async function visibilityAndOwner(input: KnowledgeInput, before?: Before): Promise<{ clientVisible?: boolean; ownerId?: string | null }> {
  const out: { clientVisible?: boolean; ownerId?: string | null } = {};
  const after = {
    sensitivity: input.sensitivity ?? before?.sensitivity,
    audience: input.audience ?? before?.audience,
    doNotDisclose: input.doNotDisclose !== undefined ? input.doNotDisclose : before?.doNotDisclose,
  };
  const blocker = clientVisibleBlocker(after);
  if (input.clientVisible === true) {
    if (blocker) throw new Error(blocker);
    out.clientVisible = true;
  } else if (input.clientVisible === false) {
    out.clientVisible = false;
  } else if (before?.clientVisible && blocker) {
    // It became sensitive, restricted or not to be told: it stops being shown.
    out.clientVisible = false;
  }
  if (input.ownerId !== undefined) {
    if (input.ownerId) {
      const ok = await prisma.user.count({ where: { id: input.ownerId, deletedAt: null, role: { not: "CLIENT_USER" } } });
      if (!ok) throw new Error("הבעלים של פריט צריך להיות איש צוות של אנקורה.");
    }
    out.ownerId = input.ownerId || null;
  }
  return out;
}

/// A status other than "confirmed" has to say what would confirm it. That
/// sentence is what turns a question mark into somebody's next step.
export function assertResolvable(status: KnowledgeStatus | undefined, toResolve: string | null | undefined) {
  if ((status === "UNCERTAIN" || status === "MISSING") && !toResolve?.trim()) {
    throw new Error('בפריט "לא ודאי" או "חסר" צריך לכתוב מה יסגור אותו.');
  }
}
