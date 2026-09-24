import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getTaskDetail, assignableUsers } from "@/lib/app-domain/tasks";
import { listCategories } from "@/lib/app-domain/categories";
import { getActiveTimer } from "@/lib/app-domain/time-entries";
import { Forbidden } from "@/components/app/Forbidden";
import { NotFound } from "@/components/app/states/NotFound";
import { TaskDetail } from "./TaskDetail";
import { TaskHistory } from "./TaskHistory";
import { TaskTimeSummary } from "./TaskTimeSummary";

export const metadata = { robots: { index: false, follow: false } };

// Tasks phase 1 (tasks-system spec, stage 1): the screen a task never had.
//
// Everything on it is either a field that existed with no control, or a
// read that existed with no reader. `assignedToId` and `dueDate` have been
// on the model since phase 10 and only the important-dates job and the MCP
// server ever wrote them. `AuditEvent` has recorded every task mutation
// since phase 1 and nothing displayed it. `TimeEntry.taskId` has existed
// since phase 2. The three genuinely new columns are description, priority
// and startedAt.
//
// Gated exactly like the Tasks list (time_entry.create_self): there is no
// task.* permission by design - see lib/app-auth/permissions.ts's phase 9
// note. Whether a person may act on this task reduces to whether they may
// act on its client, and getTaskDetail answers that by returning null.
export default async function TaskDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) return <Forbidden />;

  const detail = await getTaskDetail(user, id);
  // Null covers both "no such task" and "not your client", and the screen
  // says the same thing for both on purpose: a different message for the
  // second would confirm that a task exists on a client this person has
  // no access to.
  if (!detail) {
    return (
      <NotFound
        title="המשימה לא נמצאה"
        description="ייתכן שהמשימה נמחקה, או שהיא שייכת ללקוח שאינו משויך אליך."
        backHref="/app/tasks"
        backLabel="חזרה למשימות"
      />
    );
  }

  const { task, time, history } = detail;

  const [people, allCategories, activeTimer] = await Promise.all([
    assignableUsers(user, task.clientId),
    listCategories(),
    getActiveTimer(user.id),
  ]);

  // The same filter the create form uses: global categories, plus the
  // client-specific ones belonging to THIS client. An inactive category
  // stays in the list only when it is the one already on the task, so
  // that opening the screen cannot silently blank a field.
  const categories = allCategories
    .filter(
      (c) =>
        (c.active || c.id === task.categoryId) &&
        (c.visibility === "GLOBAL" || c.clientId === task.clientId)
    )
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-[13px] text-appNavy/50">
        <Link href="/app/tasks" className="hover:text-appNavy">
          משימות
        </Link>
        <ChevronRight size={14} className="rotate-180" />
        <span className="truncate text-appNavy/70">{task.client.name}</span>
      </nav>

      <TaskDetail
        task={{
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: task.status,
          clientName: task.client.name,
          categoryId: task.categoryId,
          assignedToId: task.assignedToId,
          assignedToName: task.assignedTo?.name ?? null,
          supervisorId: task.supervisorId,
          supervisorName: task.supervisor?.name ?? null,
          requiresApproval: task.requiresApproval,
          approvedByName: task.approvedBy?.name ?? null,
          approvedAt: task.approvedAt?.toISOString() ?? null,
          dueDate: task.dueDate?.toISOString() ?? null,
          clientVisible: task.clientVisible,
          clientTitle: task.clientTitle,
          clientOutcome: task.clientOutcome,
          startedAt: task.startedAt?.toISOString() ?? null,
          completedAt: task.completedAt?.toISOString() ?? null,
          createdAt: task.createdAt.toISOString(),
        }}
        people={people}
        categories={categories}
        // Whether THIS person may sign. Computed on the server beside the
        // rule it mirrors (assertApprovable), not guessed in the browser:
        // the screen uses it to decide which button to show, and the
        // domain refuses the write regardless, so a wrong answer here is
        // a confusing screen rather than a hole.
        canApprove={user.id === task.supervisorId || can(user.role, "time_entry.edit_others")}
        // Only this person's own timer, and only enough of it to answer
        // two questions: is one running, and is it on this task.
        activeTimer={
          activeTimer
            ? {
                id: activeTimer.id,
                startAt: activeTimer.startAt.toISOString(),
                onThisTask: activeTimer.taskId === task.id,
              }
            : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <TaskTimeSummary time={time} />
        <TaskHistory
          entries={history.map((h) => ({
            id: h.id,
            at: h.at.toISOString(),
            actorName: h.actorName,
            label: h.label,
            changed: h.changed,
          }))}
        />
      </div>
    </div>
  );
}
