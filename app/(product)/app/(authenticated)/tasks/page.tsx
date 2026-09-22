import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listTasks } from "@/lib/app-domain/tasks";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { Forbidden } from "@/components/app/Forbidden";
import { EmptyState } from "@/components/app/states/EmptyState";
import { Drawer } from "@/components/app/Drawer";
import { CreateTaskForm } from "./CreateTaskForm";
import { TaskRow } from "./TaskRow";
import { ListChecks } from "lucide-react";
import type { TaskStatus } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

// App redesign (handoff README, screen 4 "משימות"): "מתג סטטוס בגלולה
// (הכל / פתוחות / בטיפול / הושלמו)". ARCHIVED deliberately has no pill
// here (matching the reference screenshot) - it stays reachable only
// through each row's own status control, same as before this redesign.
const FILTER_PILLS: { value: TaskStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "הכל" },
  { value: "OPEN", label: "פתוחות" },
  { value: "IN_PROGRESS", label: "בטיפול" },
  { value: "DONE", label: "הושלמו" },
];

// The pre-redesign client/category <select> filter bar is intentionally
// dropped here - neither the handoff README's screen-4 bullet nor its
// screenshot show one, only the status pills + "+ משימה". listTasks()
// still accepts clientId/categoryId filters (searchParams still flow
// through below), so a future request to bring a client filter back is a
// UI-only change, not a domain one.

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec §11): the "Tasks"
// screen never existed - open/recent tasks, filterable by client/category/
// status. Gated the same as the timer (time_entry.create_self): every
// role that tracks time may see and create tasks for clients they're
// assigned to; CLIENT_USER never reaches this route (separate nav array
// in AppShell, spec 13's portal-isolation rule).
export default async function TasksPage(
  props: {
    searchParams: Promise<{ clientId?: string; categoryId?: string; status?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const status =
    searchParams.status === "OPEN" || searchParams.status === "IN_PROGRESS" || searchParams.status === "DONE"
      ? (searchParams.status as TaskStatus)
      : undefined;
  const activePill = status ?? "ALL";

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
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-appNavy">משימות</h1>
          <p className="mt-1 text-sm text-appNavy/60">משימות פתוחות ואחרונות, לפי לקוח, קטגוריה וסטטוס.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex rounded-full border border-lineDark bg-white p-[3px]">
            {FILTER_PILLS.map((pill) => (
              <Link
                key={pill.value}
                href={pill.value === "ALL" ? "/app/tasks" : `/app/tasks?status=${pill.value}`}
                className={`rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors ${
                  activePill === pill.value ? "bg-appNavy text-cream" : "text-appNavy/60 hover:text-appNavy"
                }`}
              >
                {pill.label}
              </Link>
            ))}
          </div>
          <span className="flex-1" />
          <Drawer triggerLabel="+ משימה" title="משימה חדשה">
            <CreateTaskForm clients={clients} categories={categories} />
          </Drawer>
        </div>

        {tasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="אין עדיין משימות"
            description="הוספת משימה ראשונה תופיע כאן, לפי הלקוח והקטגוריה שבחרתם."
          />
        ) : (
          <div className="divide-y divide-lineDark rounded-2xl border border-lineDark bg-white">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={{
                  id: task.id,
                  title: task.title,
                  clientName: task.client.name,
                  categoryName: task.category?.name ?? null,
                  dueDate: task.dueDate?.toISOString() ?? null,
                  status: task.status,
                  clientVisible: task.clientVisible,
                  clientTitle: task.clientTitle,
                  waitingOnClient: task.waitingOnClientSince !== null,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
