import "server-only";
import { prisma } from "@/lib/prisma";

/// When each task was sent for approval, from the audit log.
///
/// Not updatedAt: any edit moves it, and "waiting on your signature for
/// two days" has to mean two days since it was handed over, not since
/// somebody fixed a typo. Falls back to updatedAt where the log has no row.
export async function sentForApprovalAt(taskIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (taskIds.length === 0) return out;
  const rows = await prisma.auditEvent.findMany({
    where: { entityType: "Task", entityId: { in: taskIds }, action: { in: ["task.update", "task.status_change"] } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, beforeJson: true, afterJson: true, createdAt: true },
  });
  // The newest row that MOVED the task into approval. A later edit that
  // left it there writes the whole row too, and is not the handover.
  const statusOf = (row: unknown) => (row && typeof row === "object" ? (row as Record<string, unknown>).status : undefined);
  for (const r of rows) {
    if (!r.entityId || out.has(r.entityId)) continue;
    if (statusOf(r.afterJson) === "PENDING_APPROVAL" && statusOf(r.beforeJson) !== "PENDING_APPROVAL") {
      out.set(r.entityId, r.createdAt);
    }
  }
  return out;
}
