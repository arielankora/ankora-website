import "server-only";
import { prisma } from "@/lib/prisma";
import type { TaskStatus } from "@prisma/client";
import {
  looksLikeProcedure,
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
    select: { id: true, clientId: true, parentId: true, mappingTask: true },
  });
  // Steps are checklist lines; the task above them is what gets filed.
  if (!task || task.parentId) return null;

  const documents = await prisma.clientDocument.findMany({
    where: { taskId: task.id, deletedAt: null },
    select: { id: true, kind: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  const procedureDocumentIds = documents.filter((d) => d.kind === "PROCEDURE").map((d) => d.id);
  // A procedure filed as something else, by its name (20.10.2026). An
  // insurance policy filed as POLICY ("פוליסה") is not one.
  const namedProcedureDocumentIds = documents
    .filter((d) => d.kind !== "PROCEDURE" && looksLikeProcedure(d.title))
    .map((d) => d.id);
  // The flag alone (20.10.2026). The description line only sets it, when
  // a task is created or its description rewritten; reading the line here
  // as well meant that switching the flag off on the task screen changed
  // nothing while the line was still in the description.
  const isMapping = task.mappingTask;
  // Nothing to look for: skip the register entirely, which is the common
  // case for an ordinary task closing.
  if (procedureDocumentIds.length === 0 && namedProcedureDocumentIds.length === 0 && !isMapping) return null;

  // Any source of this client that names the task or one of its
  // documents, with at least one proposal batch sent from it. A source
  // registered and never used does not count.
  const ids = new Set([task.id, ...documents.map((d) => d.id)]);
  const sources = await prisma.clientSource.findMany({
    where: { clientId: task.clientId, deletedAt: null },
    select: { id: true, externalRefs: true },
  });
  const sourceIds = sources.filter((s) => refersTo(s.externalRefs, ids)).map((s) => s.id);
  // 20.10.2026: a batch counts only while something in it still stands,
  // waiting or approved. A batch whose every proposal was rejected left
  // nothing in the file, and counting it meant a procedure rejected by
  // mistake was never mentioned again.
  const hasProposalFromTask =
    sourceIds.length > 0 &&
    (await prisma.knowledgeBatch.count({
      where: { clientId: task.clientId, sourceId: { in: sourceIds }, proposals: { some: { state: { not: "REJECTED" } } } },
    })) > 0;

  const kind = procedureReminderKind({ closing: true, procedureDocumentIds, namedProcedureDocumentIds, isMapping, hasProposalFromTask });
  if (!kind) return null;
  // Misfiled: the only procedure on the task was filed as another kind.
  const misfiled = kind === "PROCEDURE" && procedureDocumentIds.length === 0;
  const documentIds = procedureDocumentIds.length > 0 ? procedureDocumentIds : namedProcedureDocumentIds;
  return {
    kind,
    forClaude: reminderForClaude(kind, task.id, documentIds, { misfiled }),
    forScreen: reminderForScreen(kind, { misfiled }),
  };
}

/// What a screen shows after a close: the Hebrew sentence and where to go
/// to propose. Every screen that closes a task uses this one helper (the
/// task screen, the list row, the board, the timer), so a new way to close
/// a task has one line to add. A failed check is not allowed to make a
/// successful close look failed, so it answers null instead of throwing.
export type ScreenProcedureReminder = { text: string; reviewHref: string };

export async function procedureReminderForScreen(
  taskId: string,
  clientId: string,
  newStatus: TaskStatus | undefined
): Promise<ScreenProcedureReminder | null> {
  const reminder = await procedureReminderFor(taskId, newStatus).catch((err) => {
    console.error("[procedure-to-file] closing check failed", err);
    return null;
  });
  return reminder ? { text: reminder.forScreen, reviewHref: `/app/knowledge?clientId=${encodeURIComponent(clientId)}` } : null;
}
