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
import { TaskFilters } from "./TaskFilters";
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
  { value: "PENDING_APPROVAL", label: "ממתינות לאישור" },
  { value: "DONE", label: "הושלמו" },
];

/// The pill values that are real statuses, derived from the list above so
/// a pill added there is selectable without a second edit. The guard
/// below used to be three `===` comparisons, which is exactly the shape
/// that silently ignores a new one.
const FILTER_STATUSES = new Set(
  FILTER_PILLS.map((p) => p.value).filter((v): v is TaskStatus => v !== "ALL")
);

// The pre-redesign client/category filter bar was dropped by the
// redesign, on the grounds that the handoff screenshot did not show one.
// Phase 4 brings it back, together with a search box, and the note above
// turned out to be exactly right: listTasks had kept accepting
// clientId/categoryId the whole time, so this was a UI-only change.
//
// Why search rather than the board the spec lists first. A board is the
// ClickUp-shaped thing, and it is the second thing a person needs. The
// first is "where is the task about the plumber", and until this phase
// the only answer was to scroll. Tasks here are mostly short-lived and
// move OPEN to DONE through a checkbox that already exists, so a column
// view earns less than a box that finds things. The board is next.

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec §11): the "Tasks"
// screen never existed - open/recent tasks, filterable by client/category/
// status. Gated the same as the timer (time_entry.create_self): every
// role that tracks time may see and create tasks for clients they're
// assigned to; CLIENT_USER never reaches this route (separate nav array
// in AppShell, spec 13's portal-isolation rule).
export default async function TasksPage(
  props: {
    searchParams: Promise<{
      clientId?: string;
      categoryId?: string;
      status?: string;
      mine?: string;
      q?: string;
      group?: string;
    }>;
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

  const status = FILTER_STATUSES.has(searchParams.status as TaskStatus)
    ? (searchParams.status as TaskStatus)
    : undefined;
  const activePill = status ?? "ALL";

  // Team adoption, mechanism three: "mine".
  //
  // The screen has always shown every task on every client a person can
  // reach, with no way to tell which are theirs - so the answer to "what
  // am I holding" was a visual scan of somebody else's work. The column
  // has existed since phase 10; this is a filter, not a model.
  const mine = searchParams.mine === "1";
  const q = searchParams.q?.trim() || undefined;
  /// Grouped by client, which is how the people using this screen think:
  /// one account manager, one client, one set of open loops. Off by
  /// default because the flat list is already ordered by what is urgent,
  /// and grouping trades that reading for a different one.
  const grouped = searchParams.group === "client";

  const [tasks, clients, allCategories] = await Promise.all([
    listTasks(user, {
      clientId: searchParams.clientId,
      categoryId: searchParams.categoryId,
      status,
      assignedToId: mine ? user.id : undefined,
      q,
    }),
    listAccessibleClients(user),
    listCategories(),
  ]);

  const clientIds = new Set(clients.map((c) => c.id));
  const categories = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  // Both controls write the same query string, so picking a status keeps
  // "mine" on and turning "mine" off keeps the status.
  function href(next: { status?: TaskStatus | "ALL"; mine?: boolean; group?: boolean }) {
    const params = new URLSearchParams();
    if (searchParams.clientId) params.set("clientId", searchParams.clientId);
    if (searchParams.categoryId) params.set("categoryId", searchParams.categoryId);
    const nextStatus = next.status ?? activePill;
    if (nextStatus !== "ALL") params.set("status", nextStatus);
    if (next.mine ?? mine) params.set("mine", "1");
    // Carried through every pill and toggle, so narrowing by status does
    // not silently throw away what somebody searched for.
    if (q) params.set("q", q);
    if (next.group ?? grouped) params.set("group", "client");
    const query = params.toString();
    return query ? `/app/tasks?${query}` : "/app/tasks";
  }
  const pillHref = (value: TaskStatus | "ALL") => href({ status: value });
  const mineHref = href({ mine: !mine });
  const groupHref = href({ group: !grouped });

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-appNavy">משימות</h1>
          <p className="mt-1 text-sm text-appNavy/60">משימות פתוחות ואחרונות, לפי לקוח, קטגוריה וסטטוס.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <TaskFilters clients={clients} categories={categories} />
          <Drawer triggerLabel="+ משימה" title="משימה חדשה">
            <CreateTaskForm clients={clients} categories={categories} />
          </Drawer>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex rounded-full border border-lineDark bg-white p-[3px]">
            {FILTER_PILLS.map((pill) => (
              <Link
                key={pill.value}
                href={pillHref(pill.value)}
                className={`rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors ${
                  activePill === pill.value ? "bg-appNavy text-cream" : "text-appNavy/60 hover:text-appNavy"
                }`}
              >
                {pill.label}
              </Link>
            ))}
          </div>

          {/* "Mine" is a separate toggle rather than a fifth status pill:
              it answers a different question and combines with all four
              of them. */}
          <Link
            href={mineHref}
            className={`rounded-full border px-4 py-2 text-[13.5px] font-medium transition-colors ${
              mine ? "border-appNavy bg-appNavy text-cream" : "border-lineDark bg-white text-appNavy/60 hover:text-appNavy"
            }`}
          >
            שלי
          </Link>

          {/* Grouping is a way of reading the same list, not a filter on
              it, so it sits with the toggles rather than in the filter
              bar above and says what it does rather than naming a
              setting. */}
          <Link
            href={groupHref}
            className={`rounded-full border px-4 py-2 text-[13.5px] font-medium transition-colors ${
              grouped
                ? "border-appNavy bg-appNavy text-cream"
                : "border-lineDark bg-white text-appNavy/60 hover:text-appNavy"
            }`}
          >
            לפי לקוח
          </Link>
        </div>

        {tasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            // Three different nothings, and they mean three different
            // things. A search that found nothing is not a product with
            // no tasks in it, and telling somebody "אין עדיין משימות"
            // when their colleagues have forty open is simply wrong.
            title={q ? "לא נמצאו משימות" : mine ? "אין משימות פתוחות עליך" : "אין עדיין משימות"}
            description={
              q
                ? `אין משימה שמכילה "${q}" בכותרת, בתיאור, בשרשור או בשם הלקוח. אפשר לנקות את החיפוש או לוותר על אחד המסננים.`
                : mine
                  ? "כשמשימה תשויך אליך היא תופיע כאן. אפשר לכבות את המסנן כדי לראות את כל המשימות."
                  : "הוספת משימה ראשונה תופיע כאן, לפי הלקוח והקטגוריה שבחרתם."
            }
          />
        ) : grouped ? (
          <div className="space-y-5">
            {groupByClient(tasks).map(([clientName, rows]) => (
              <section key={clientName}>
                <h2 className="text-sm font-medium text-appNavy">
                  {clientName}
                  <span className="mr-2 font-normal text-appNavy/45">{rows.length}</span>
                </h2>
                <div className="mt-2 divide-y divide-lineDark rounded-2xl border border-lineDark bg-white">
                  {rows.map((task) => (
                    <TaskRow key={task.id} task={toRow(task)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-lineDark rounded-2xl border border-lineDark bg-white">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={toRow(task)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/// The row's own shape, lifted out because two branches render it now.
function toRow(task: Awaited<ReturnType<typeof listTasks>>[number]) {
  return {
    id: task.id,
    title: task.title,
    clientName: task.client.name,
    categoryName: task.category?.name ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    status: task.status,
    priority: task.priority,
    clientVisible: task.clientVisible,
    supplierName: task.supplierName,
    supplierExperience: task.supplierExperience,
    clientTitle: task.clientTitle,
    waitingOnClient: task.waitingOnClientSince !== null,
    clientOutcome: task.clientOutcome,
  };
}

/// Grouped in the order the query already produced, so within a client
/// the urgent work is still on top. The groups themselves are ordered by
/// the client whose most urgent task comes first, not alphabetically:
/// the point of this view is to see which account needs attention, and
/// sorting by name would bury that under the alphabet.
function groupByClient(tasks: Awaited<ReturnType<typeof listTasks>>) {
  const groups = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const name = task.client.name;
    const found = groups.get(name);
    if (found) found.push(task);
    else groups.set(name, [task]);
  }
  return [...groups.entries()];
}
