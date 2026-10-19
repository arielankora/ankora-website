import Link from "next/link";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Drawer } from "@/components/app/Drawer";
import { CreateTaskForm } from "../../tasks/CreateTaskForm";
import { formatDuration } from "@/lib/time-entry-format";
import { TASK_STATUS_LABELS } from "@/lib/app-domain/tasks";
import type { TaskStatus } from "@prisma/client";

const STATUS_TONE: Record<TaskStatus, "green" | "amber" | "gray" | "red"> = {
  OPEN: "gray",
  IN_PROGRESS: "amber",
  PENDING_APPROVAL: "red",
  DONE: "green",
  ARCHIVED: "gray",
};

export type ClientTaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeName: string | null;
  dueDate: string | null;
  seconds: number;
};

function formatDue(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(
    new Date(iso)
  );
}

/// Hadas, 23.9.2026: the work of a client, on the client's screen. Open
/// tasks only; the full history is one link away on the tasks screen,
/// already filtered to this client.
export function TasksPanel({
  clientId,
  clientName,
  tasks,
  openCount,
  closedRecently,
  untaskedSecondsThisMonth,
  categories,
}: {
  clientId: string;
  clientName: string;
  tasks: ClientTaskRow[];
  openCount: number;
  closedRecently: number;
  untaskedSecondsThisMonth: number;
  categories: { id: string; name: string; clientId: string | null }[];
}) {
  const now = Date.now();
  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-app-text-primary">משימות ({openCount} פתוחות)</h2>
        <div className="flex items-center gap-4">
          <Link href={`/app/tasks?clientId=${clientId}`} className="text-xs text-app-text-accent underline underline-offset-4">
            לכל המשימות של הלקוח
          </Link>
          <Drawer triggerLabel="משימה" title={`משימה חדשה: ${clientName}`}>
            <CreateTaskForm
              clients={[{ id: clientId, name: clientName }]}
              categories={categories}
              defaultClientId={clientId}
            />
          </Drawer>
        </div>
      </div>

      <p className="mt-1 text-xs text-app-text-tertiary">
        {closedRecently} נסגרו ב-30 הימים האחרונים
        {untaskedSecondsThisMonth > 0 && <> · {formatDuration(untaskedSecondsThisMonth)} שעות החודש דווחו בלי משימה</>}
      </p>

      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-app-text-tertiary">אין משימות פתוחות ללקוח זה.</p>
      ) : (
        <ul className="mt-3 divide-y divide-app-border">
          {tasks.map((t) => {
            const overdue = t.dueDate !== null && new Date(t.dueDate).getTime() < now;
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/tasks/${t.id}`} className="text-app-text-primary hover:text-app-text-accent">
                    {t.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-app-text-tertiary">
                    {t.assigneeName ?? "ללא אחראי"}
                    {t.dueDate && (
                      <span className={overdue ? "text-app-error" : undefined}> · יעד {formatDue(t.dueDate)}</span>
                    )}
                    {t.seconds > 0 && <> · {formatDuration(t.seconds)} שעות</>}
                  </p>
                </div>
                <StatusBadge label={TASK_STATUS_LABELS[t.status]} tone={STATUS_TONE[t.status]} />
              </li>
            );
          })}
        </ul>
      )}
      {openCount > tasks.length && (
        <p className="mt-2 text-xs text-app-text-tertiary">
          מוצגות {tasks.length} מתוך {openCount}.{" "}
          <Link href={`/app/tasks?clientId=${clientId}`} className="underline">
            לכל הרשימה
          </Link>
        </p>
      )}
    </div>
  );
}
