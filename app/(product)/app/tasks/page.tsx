import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listTasks, TASK_STATUS_LABELS } from "@/lib/app-domain/tasks";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { CreateTaskForm } from "./CreateTaskForm";
import { TaskStatusSelect } from "./TaskStatusSelect";
import type { TaskStatus } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

const STATUS_TONE: Record<TaskStatus, "green" | "amber" | "gray" | "red"> = {
  OPEN: "amber",
  IN_PROGRESS: "green",
  DONE: "gray",
  ARCHIVED: "gray",
};

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec §11): the "Tasks"
// screen never existed - open/recent tasks, filterable by client/category/
// status. Gated the same as the timer (time_entry.create_self): every
// role that tracks time may see and create tasks for clients they're
// assigned to; CLIENT_USER never reaches this route (separate nav array
// in AppShell, spec 13's portal-isolation rule).
export default async function TasksPage({
  searchParams,
}: {
  searchParams: { clientId?: string; categoryId?: string; status?: string };
}) {
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const status =
    searchParams.status === "OPEN" ||
    searchParams.status === "IN_PROGRESS" ||
    searchParams.status === "DONE" ||
    searchParams.status === "ARCHIVED"
      ? (searchParams.status as TaskStatus)
      : undefined;

  const [tasks, clients, allCategories] = await Promise.all([
    listTasks(user, { clientId: searchParams.clientId, categoryId: searchParams.categoryId, status }),
    listAccessibleClients(user),
    listCategories(),
  ]);

  const clientIds = new Set(clients.map((c) => c.id));
  const categories = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">משימות</h1>
          <p className="mt-1 text-sm text-navy/60">משימות פתוחות ואחרונות, לפי לקוח, קטגוריה וסטטוס.</p>
        </div>

        <CreateTaskForm clients={clients} categories={categories} />

        <form className="flex flex-wrap items-end gap-4 rounded-2xl border border-lineDark bg-white p-4">
          <div>
            <label className="block text-xs font-medium text-navy/60">לקוח</label>
            <select
              name="clientId"
              defaultValue={searchParams.clientId ?? ""}
              className="mt-1.5 rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="">כל הלקוחות</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-navy/60">סטטוס</label>
            <select
              name="status"
              defaultValue={searchParams.status ?? ""}
              className="mt-1.5 rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="">כל הסטטוסים</option>
              {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-full border border-lineDark px-4 py-2 text-sm text-navy hover:border-gold">
            סינון
          </button>
        </form>

        <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead>
              <tr className="border-b border-lineDark text-xs text-navy/50">
                <th className="px-5 py-3 font-medium">משימה</th>
                <th className="px-5 py-3 font-medium">לקוח</th>
                <th className="px-5 py-3 font-medium">קטגוריה</th>
                <th className="px-5 py-3 font-medium">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-navy/50">
                    אין עדיין משימות. הוסיפו משימה ראשונה למעלה.
                  </td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-lineDark last:border-0">
                  <td className="px-5 py-3 font-medium text-navy">{task.title}</td>
                  <td className="px-5 py-3 text-navy/70">{task.client.name}</td>
                  <td className="px-5 py-3 text-navy/70">{task.category?.name ?? "-"}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge label={TASK_STATUS_LABELS[task.status]} tone={STATUS_TONE[task.status]} />
                      <TaskStatusSelect taskId={task.id} status={task.status} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
