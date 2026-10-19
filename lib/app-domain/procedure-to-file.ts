import "server-only";
import { prisma } from "@/lib/prisma";
import type { TaskStatus } from "@prisma/client";
import {
  isMappingTask,
  procedureReminderKind,
  reminderForClaude,
  reminderForScreen,
  type ProcedureReminderKind,
} from "@/lib/procedure-to-file";

// The closing check (lib/procedure-to-file.ts has the why). Called after a
// task's status changed, by both ways a task closes: update_task over MCP
// and the task screen. It reads, it never writes and never refuses: the
// close has already happened by the time it runs.

export type ProcedureReminder = {
  kind: ProcedureReminderKind;
  /// English, for Claude, in the tool result.
  forClaude: string;
  /// Hebrew, for the banner on the task screen.
  forScreen: string;
};

const CLOSING: readonly TaskStatus[] = ["DONE", "PENDING_APPROVAL"];

/// Whether a source's external references point at the task or at one of
/// its documents. The register keeps them as [{ system, id }].
function refersTo(externalRefs: unknown, ids: ReadonlySet<string>): boolean {
  return Array.isArray(externalRefs) && externalRefs.some((r) => typeof r?.id === "string" && ids.has(r.id));
}

export async function procedureReminderFor(taskId: string, newStatus: TaskStatus | undefined): Promise<ProcedureReminder | null> {
  if (!newStatus || !CLOSING.includes(newStatus)) return null;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, clientId: true, parentId: true, description: true },
  });
  // Steps are checklist lines; the task above them is what gets filed.
  if (!task || task.parentId) return null;

  const documents = await prisma.clientDocument.findMany({
    where: { taskId: task.id, deletedAt: null },
    select: { id: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  const policyDocumentIds = documents.filter((d) => d.kind === "POLICY").map((d) => d.id);
  const isMapping = isMappingTask(task.description);
  // Nothing to look for: skip the register entirely, which is the common
  // case for an ordinary task closing.
  if (policyDocumentIds.length === 0 && !isMapping) return null;

  // Any source of this client that names the task or one of its
  // documents, with at least one proposal batch sent from it. A source
  // registered and never used does not count.
  const ids = new Set([task.id, ...documents.map((d) => d.id)]);
  const sources = await prisma.clientSource.findMany({
    where: { clientId: task.clientId, deletedAt: null },
    select: { id: true, externalRefs: true },
  });
  const sourceIds = sources.filter((s) => refersTo(s.externalRefs, ids)).map((s) => s.id);
  const hasProposalFromTask =
    sourceIds.length > 0 && (await prisma.knowledgeBatch.count({ where: { clientId: task.clientId, sourceId: { in: sourceIds } } })) > 0;

  const kind = procedureReminderKind({ closing: true, policyDocumentIds, isMapping, hasProposalFromTask });
  if (!kind) return null;
  return {
    kind,
    forClaude: reminderForClaude(kind, task.id, policyDocumentIds),
    forScreen: reminderForScreen(kind),
  };
}
