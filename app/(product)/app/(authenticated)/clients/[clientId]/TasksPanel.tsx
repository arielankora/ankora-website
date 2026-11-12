import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Drawer } from "@/components/app/Drawer";
import { CreateTaskForm } from "../../tasks/CreateTaskForm";
import { formatDuration } from "@/lib/time-entry-format";
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
  const t = useTranslations("clients.tasks");
  const format = useFormatter();
  const formatDue = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "numeric" });
  const now = Date.now();
  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-app-text-primary">{t("title", { count: openCount })}</h2>
        <div className="flex items-center gap-4">
          <Link href={`/app/tasks?clientId=${clientId}`} className="text-xs text-app-text-accent underline underline-offset-4">
            {t("allTasks")}
          </Link>
          <Drawer triggerLabel={t("newTrigger")} title={t("newTitle", { name: clientName })}>
            <CreateTaskForm
              clients={[{ id: clientId, name: clientName }]}
              categories={categories}
              defaultClientId={clientId}
            />
          </Drawer>
        </div>
      </div>

      <p className="mt-1 text-xs text-app-text-tertiary">
        {t("closedRecently", { count: closedRecently })}
        {untaskedSecondsThisMonth > 0 && <> · {t("untasked", { hours: formatDuration(untaskedSecondsThisMonth) })}</>}
      </p>

      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-app-text-tertiary">{t("empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-app-border">
          {tasks.map((task) => {
            const overdue = task.dueDate !== null && new Date(task.dueDate).getTime() < now;
            return (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/tasks/${task.id}`} dir="auto" className="text-app-text-primary hover:text-app-text-accent">
                    {task.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-app-text-tertiary">
                    {task.assigneeName ?? t("noAssignee")}
                    {task.dueDate && (
                      <span className={overdue ? "text-app-error" : undefined}> · {t("due", { date: formatDue(task.dueDate) })}</span>
                    )}
                    {task.seconds > 0 && <> · {t("hours", { hours: formatDuration(task.seconds) })}</>}
                  </p>
                </div>
                <StatusBadge label={t(`status.${task.status}`)} tone={STATUS_TONE[task.status]} />
              </li>
            );
          })}
        </ul>
      )}
      {openCount > tasks.length && (
        <p className="mt-2 text-xs text-app-text-tertiary">
          {t("showing", { shown: tasks.length, total: openCount })}{" "}
          <Link href={`/app/tasks?clientId=${clientId}`} className="underline">
            {t("fullList")}
          </Link>
        </p>
      )}
    </div>
  );
}
