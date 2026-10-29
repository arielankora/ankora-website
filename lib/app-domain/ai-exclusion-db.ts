import "server-only";
import { prisma } from "@/lib/prisma";
import { documentAiExclusion, taskAiExclusion } from "@/lib/ai-exclusion";

// 28.10.2026: "בלי AI", the questions that need the database. The rule
// itself is in lib/ai-exclusion.ts; this only fetches the three flags it
// reads, so every AI-facing path (the MCP tools above all) asks the same
// question the same way instead of selecting its own subset of them.

const TASK_FLAGS = {
  aiExcluded: true,
  parent: { select: { aiExcluded: true } },
  client: { select: { aiExcluded: true } },
} as const;

/// Of these task ids, the ones an AI-facing reader may not see. Unknown
/// ids are left out of the answer, not reported as excluded: the caller
/// already decided they exist.
export async function aiExcludedTaskIds(ids: Iterable<string>): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const rows = await prisma.task.findMany({ where: { id: { in: unique } }, select: { id: true, ...TASK_FLAGS } });
  return new Set(rows.filter((t) => taskAiExclusion(t) !== null).map((t) => t.id));
}

export async function isTaskAiExcluded(taskId: string): Promise<boolean> {
  return (await aiExcludedTaskIds([taskId])).has(taskId);
}

/// Of these client ids, the ones marked "בלי AI".
export async function aiExcludedClientIds(ids: Iterable<string>): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const rows = await prisma.client.findMany({ where: { id: { in: unique }, aiExcluded: true }, select: { id: true } });
  return new Set(rows.map((c) => c.id));
}

export async function isDocumentAiExcluded(documentId: string): Promise<boolean> {
  const doc = await prisma.clientDocument.findUnique({
    where: { id: documentId },
    select: {
      aiExcluded: true,
      client: { select: { aiExcluded: true } },
      task: { select: { aiExcluded: true, parent: { select: { aiExcluded: true } } } },
    },
  });
  return !!doc && documentAiExclusion(doc) !== null;
}
