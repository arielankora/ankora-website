import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { OPEN_STATUSES, listTasks } from "@/lib/app-domain/tasks";
import { timed } from "@/lib/slow-log";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { Forbidden } from "@/components/app/Forbidden";
import { EmptyState } from "@/components/app/states/EmptyState";
import { Drawer } from "@/components/app/Drawer";
import { NEW_TASK_KEY } from "@/components/app/drawer-keys";
import { CreateTaskForm } from "./CreateTaskForm";
import { TaskRow } from "./TaskRow";
import { TaskFilters } from "./TaskFilters";
import { TaskListProvider, type ListRow } from "./TaskListProvider";
import { TaskListView } from "./TaskListView";
import { ListChecks } from "lucide-react";
import type { TaskStatus } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

// App redesign (handoff README, screen 4 "משימות"): "מתג סטטוס בגלולה
// (הכל / פתוחות / בטיפול / הושלמו)". ARCHIVED deliberately has no pill
// here (matching the reference screenshot) - it stays reachable only
// through each row's own status control, same as before this redesign.
// Ariel, 26.9.2026: "אין אופציה לראות את כל המשימות הפתוחות בלי
// ההושלמו, ההושלמו זאת רשימה ארוכה שרק תלך ותיגדל".
//
// So the first pill, and the default, is "פעילות": everything not
// finished (open, in progress, waiting for approval). "הכל" is gone: a
// list that grows by every task ever closed is not a working view, and
// the closed ones have their own pill. ARCHIVED still has no pill and is
// reachable only through a row's own status control, as before.
const FILTER_PILLS: { value: TaskStatus | "ACTIVE"; label: string }[] = [
  { value: "ACTIVE", label: "פעילות" },
  { value: "OPEN", label: "פתוחות" },
  { value: "IN_PROGRESS", label: "בטיפול" },
  { value: "PENDING_APPROVAL", label: "ממתינות לאישור" },
  { value: "DONE", label: "הושלמו" },
];

/// The pill values that are real statuses, derived from the list above so
/// a pill added there is selectable without a second edit.
const FILTER_STATUSES = new Set(
  FILTER_PILLS.map((p) => p.value).filter((v): v is TaskStatus => v !== "ACTIVE"),
);

/// "פעילות": every status that is still somebody's work.
const ACTIVE_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"];

/// "הושלמו" shows this many days back unless asked for everything. A
/// month covers "what did we close lately" and keeps the pill a page
/// rather than an archive.
const DONE_WINDOW_DAYS = 30;

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
export default async function TasksPage(props: {
  searchParams: Promise<{
    clientId?: string;
    categoryId?: string;
    status?: string;
    mine?: string;
    closed?: string;
    q?: string;
    group?: string;
    view?: string;
  }>;
}) {
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
  const activePill = status ?? "ACTIVE";

  // Team adoption, mechanism three: "mine".
  //
  // The screen has always shown every task on every client a person can
  // reach, with no way to tell which are theirs - so the answer to "what
  // am I holding" was a visual scan of somebody else's work. The column
  // has existed since phase 10; this is a filter, not a model.
  //
  // On by default since 26.9.2026 (Ariel): the first thing a person
  // opening this screen wants is their own list. `mine=0` turns it off;
  // `mine=1` still means on, so every link written before today works.
  // "Mine" is assignee OR supervisor - see TaskFilters.involvedUserId.
  const mine = searchParams.mine !== "0";
  /// "הושלמו" only: the whole history instead of the last month.
  const allClosed = searchParams.closed === "all";
  const q = searchParams.q?.trim() || undefined;
  /// Grouped by client, which is how the people using this screen think:
  /// one account manager, one client, one set of open loops. Off by
  /// default because the flat list is already ordered by what is urgent,
  /// and grouping trades that reading for a different one.
  const grouped = searchParams.group === "client";
  /// The board. A way of looking at the same query, so it lives on this
  /// route with the same filters rather than on a route of its own: a
  /// board that could not be narrowed to one client would be a wall of
  /// cards, and a second route would mean two places to keep the filter
  /// bar working.
  const board = searchParams.view === "board";

  // A status filter on the board would empty three of its four columns,
  // which is not a filtered board, it is a broken one. The pills are
  // hidden in that view and the value is ignored rather than carried,
  // so switching to the board never shows a column somebody cannot see
  // the reason for.
  const listStatus = board ? undefined : status;

  // Measured, because this screen is the one everything else gets blamed
  // on.
  //
  // Its own comments call it "the slowest render in the product". Its
  // browser test carries a sixty-second wait with a paragraph explaining
  // why thirty was not enough. Six CI runs in one day failed on timeouts
  // around it, and the refresh investigation circled it for five rounds
  // and ended by routing around it rather than measuring it.
  //
  // Nobody has a number. This is the number: one line, only when the load
  // crosses what a person would wait for, saying how long and on how
  // much. Without the counts the line cannot tell a slow query from a
  // large answer, which are opposite problems.
  //
  // Note what is NOT measured here: the React render that follows. This
  // times the data, the same as the dashboard does, so the two are
  // comparable. If the data is fast and the screen still is not, that is
  // itself the finding.
  const [tasks, clients, allCategories] = await timed(
    "screen.tasks.load",
    () =>
      Promise.all([
        listTasks(user, {
          clientId: searchParams.clientId,
          categoryId: searchParams.categoryId,
          status: listStatus,
          statusIn: board || listStatus ? undefined : ACTIVE_STATUSES,
          completedSince:
            listStatus === "DONE" && !allClosed ? new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000) : undefined,
          involvedUserId: mine ? user.id : undefined,
          q,
        }),
        listAccessibleClients(user),
        listCategories(),
      ]),
    (result) =>
      result
        ? `${result[0].length} tasks, ${result[1].length} clients, ${result[2].length} categories${q ? ", searching" : ""}${board ? ", board" : ""}`
        : "(failed)"
  );

  const clientIds = new Set(clients.map((c) => c.id));
  const categories = allCategories.filter(
    (cat) =>
      cat.active &&
      (cat.visibility === "GLOBAL" ||
        (cat.clientId && clientIds.has(cat.clientId))),
  );

  // Both controls write the same query string, so picking a status keeps
  // "mine" on and turning "mine" off keeps the status.
  function href(next: {
    status?: TaskStatus | "ACTIVE";
    mine?: boolean;
    group?: boolean;
    view?: "list" | "board";
  }) {
    const params = new URLSearchParams();
    if (searchParams.clientId) params.set("clientId", searchParams.clientId);
    if (searchParams.categoryId)
      params.set("categoryId", searchParams.categoryId);
    const nextStatus = next.status ?? activePill;
    if (nextStatus !== "ACTIVE") params.set("status", nextStatus);
    // On is the default, so only "off" needs saying.
    if (!(next.mine ?? mine)) params.set("mine", "0");
    // Carried through every pill and toggle, so narrowing by status does
    // not silently throw away what somebody searched for.
    if (q) params.set("q", q);
    if (next.group ?? grouped) params.set("group", "client");
    const nextView = next.view ?? (board ? "board" : "list");
    if (nextView === "board") params.set("view", "board");
    const query = params.toString();
    return query ? `/app/tasks?${query}` : "/app/tasks";
  }
  const pillHref = (value: TaskStatus | "ACTIVE") => href({ status: value });
  const allClosedHref = `${href({})}${href({}).includes("?") ? "&" : "?"}closed=all`;
  const mineHref = href({ mine: !mine });
  const groupHref = href({ group: !grouped });
  const listHref = href({ view: "list" });
  const boardHref = href({ view: "board" });

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-appNavy">משימות</h1>
          <p className="mt-1 text-sm text-appNavy/60">
            משימות פתוחות ואחרונות, לפי לקוח, קטגוריה וסטטוס.
          </p>
        </div>

        <TaskListProvider
          rows={tasks.map(toRow)}
          // What a newly created task has to survive to belong on the
          // screen as it is filtered right now. The client's NAME and not
          // only its id, because the row the action returns carries the
          // name and comparing an id to a name is how a row that belongs
          // gets dropped.
          filters={{
            status: listStatus,
            clientId: searchParams.clientId,
            clientName: clients.find((c) => c.id === searchParams.clientId)
              ?.name,
            // The create form can now name an assignee, so a task born
            // on somebody else no longer belongs under "שלי".
            involvedUserId: mine ? user.id : undefined,
          }}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <TaskFilters clients={clients} categories={categories} />
            {/* The trigger is for phones only since 26.9.2026: on a desk
              "משימה חדשה" sits in the top bar and opens this same drawer
              (openKey), and two buttons for one action is one too many.
              The top bar is hidden below md, so a phone keeps this one. */}
            <Drawer triggerLabel="משימה" title="משימה חדשה" openKey={NEW_TASK_KEY} triggerClassName="md:hidden">
              <CreateTaskForm clients={clients} categories={categories} />
            </Drawer>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* The view switch comes first because it changes what the
              controls beside it mean. On the board the status pills and
              the grouping toggle are not hidden to simplify the screen,
              they are hidden because the board already answers both
              questions: its columns ARE the statuses. */}
            <div className="flex rounded-full border border-lineDark bg-white p-[3px]">
              {[
                { href: listHref, label: "רשימה", active: !board },
                { href: boardHref, label: "לוח", active: board },
              ].map((view) => (
                <Link
                  key={view.label}
                  href={view.href}
                  className={`rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors ${
                    view.active
                      ? "bg-appNavy text-cream"
                      : "text-appNavy/60 hover:text-appNavy"
                  }`}
                >
                  {view.label}
                </Link>
              ))}
            </div>

            {/* Scrolls sideways on a phone rather than running off the
              edge: five pills are wider than a 360px screen, and before
              26.9.2026 the last one was simply cut off, with "ממתינות
              לאישור" folded onto two lines beside it. */}
            {!board && (
              <div
                data-testid="status-pills"
                className="flex max-w-full overflow-x-auto rounded-full border border-lineDark bg-white p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {FILTER_PILLS.map((pill) => (
                  <Link
                    key={pill.value}
                    href={pillHref(pill.value)}
                    className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors ${
                      activePill === pill.value
                        ? "bg-appNavy text-cream"
                        : "text-appNavy/60 hover:text-appNavy"
                    }`}
                  >
                    {pill.label}
                  </Link>
                ))}
              </div>
            )}

            {/* "Mine" is a separate toggle rather than a fifth status pill:
              it answers a different question and combines with all four
              of them. */}
            <Link
              href={mineHref}
              className={`rounded-full border px-4 py-2 text-[13.5px] font-medium transition-colors ${
                mine
                  ? "border-appNavy bg-appNavy text-cream"
                  : "border-lineDark bg-white text-appNavy/60 hover:text-appNavy"
              }`}
            >
              שלי
            </Link>

            {/* Grouping is a way of reading the same list, not a filter on
              it, so it sits with the toggles rather than in the filter
              bar above and says what it does rather than naming a
              setting. */}
            {!board && (
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
            )}
          </div>

          <TaskListView board={board} grouped={grouped} mine={mine} q={q} />

          {/* Says what the pill is hiding and how to see it, rather than
              leaving somebody to wonder where March went. */}
          {!board && listStatus === "DONE" && !allClosed && (
            <p className="text-[12.5px] text-appNavy/55">
              מוצגות משימות שהושלמו ב-{DONE_WINDOW_DAYS} הימים האחרונים.{" "}
              <Link href={allClosedHref} className="text-gold-dim underline underline-offset-4">
                להצגת כל ההיסטוריה
              </Link>
            </p>
          )}
        </TaskListProvider>
      </div>
    </>
  );
}

/// The one shape every view on this screen renders from.
///
/// The list, the grouped list and the board all read it, and so does the
/// row a create returns, which is why it is a named type rather than an
/// inferred object: the action builds the same shape on the server, and
/// the compiler is what keeps the two from drifting.
function toRow(task: Awaited<ReturnType<typeof listTasks>>[number]): ListRow {
  return {
    id: task.id,
    title: task.title,
    clientName: task.client.name,
    categoryName: task.category?.name ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    status: task.status,
    priority: task.priority,
    assignedToId: task.assignedTo?.id ?? null,
    assignedToName: task.assignedTo?.name ?? null,
    supervisorId: task.supervisor?.id ?? null,
    supervisorName: task.supervisor?.name ?? null,
    clientVisible: task.clientVisible,
    supplierName: task.supplierName,
    supplierExperience: task.supplierExperience,
    clientTitle: task.clientTitle,
    blockedOn: task.blockedOn,
    blockedSince: task.blockedSince?.toISOString() ?? null,
    clientOutcome: task.clientOutcome,
    stepsTotal: task.subtasks.length,
    stepsDone: task.subtasks.filter((s) => !OPEN_STATUSES.includes(s.status)).length,
  };
}
