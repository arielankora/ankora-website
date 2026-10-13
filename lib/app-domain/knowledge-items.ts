import "server-only";
import { parseFieldStatus, type FieldStatusMap } from "@/lib/knowledge";
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
  before?: { knowledgeStatus: KnowledgeStatus; sources: unknown; toResolve: string | null }
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
  };
}

/// A status other than "confirmed" has to say what would confirm it. That
/// sentence is what turns a question mark into somebody's next step.
export function assertResolvable(status: KnowledgeStatus | undefined, toResolve: string | null | undefined) {
  if ((status === "UNCERTAIN" || status === "MISSING") && !toResolve?.trim()) {
    throw new Error('בפריט "לא ודאי" או "חסר" צריך לכתוב מה יסגור אותו.');
  }
}
