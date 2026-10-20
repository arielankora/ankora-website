"use client";
import Link from "next/link";
import { CalendarDays, Clock, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { taskHref } from "../tasks/list-query";
import { setTaskDueDateAction } from "./actions";
import { calendarFrom, dayOfMonth, shortDate, WEEKDAY_LABELS, type CalendarDrawer, type CalendarView } from "@/lib/calendar-keys";
import type { CalendarDate, CalendarTask } from "@/lib/app-domain/calendar";

// The calendar's grid and its drawer: tasks with no due date, and tasks
// whose due date has passed.
//
// 20.10.2026 (Ariel): the drawer replaced a fixed side column that took a
// quarter of the width all the time and folded every title in the week
// into seven lines. It opens from two buttons above the grid, sits beside
// it rather than over it, and stays open while a task is dragged out of
// it, which is the whole point of having it.
//
// **Dragging changes one thing: the due date.** It calls the same
// `updateTask` as the task screen, through setTaskDueDateAction, so the
// audit row and the access check are the task screen's own. Native HTML5
// drag, like the board: no library, and the board's e2e technique
// (dispatching DragEvent with a shared DataTransfer) works here too.
//
// Three things are deliberate:
//   - Optimistic, reverted in full on a refusal, with an undo on success.
//     A drag is easy to drop one cell off, and an undo is cheaper than a
//     confirmation on every move.
//   - A task the client sees on their portal asks first. Its due date is
//     a promise on somebody else's screen.
//   - Dropping on the side panel removes the due date. The panel is
//     "tasks with no date", so that is what landing there means.
//
// Dates (important dates) are drawn but never dragged: a birthday does
// not move because the calendar was rearranged.

type DropZone = {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
};

/// Items a month cell draws before "ועוד N". A month cell is a glance,
/// not a list; the day view is the list.
const MONTH_CELL_CAP = 4;

/// Sunday to Thursday full width, Friday and Saturday at 0.7 (0.55 until
/// 20.10.2026, which left a Friday task two words wide with the drawer open):
/// the weekend is where almost nothing is due, and equal columns spent a
/// fifth of the grid on two near-empty days.
const GRID_COLUMNS = "grid-cols-[repeat(5,minmax(0,1fr))_repeat(2,minmax(0,0.7fr))]";

const PRIORITY_DOT: Record<CalendarTask["priority"], string> = {
  LOW: "bg-transparent",
  NORMAL: "bg-transparent",
  HIGH: "bg-app-warning",
  URGENT: "bg-app-error",
};

type Props = {
  view: CalendarView;
  anchor: string;
  today: string;
  days: string[];
  /// Dated and undated together. `dueKey: null` is the side panel.
  tasks: CalendarTask[];
  dates: CalendarDate[];
  /// Which list the drawer shows; absent = closed.
  drawer?: CalendarDrawer;
  /// Built on the server from the same calendarHref as every control.
  drawerHrefs: { undated: string; overdue: string; close: string };
  undatedMore: boolean;
  overdueMore: boolean;
  /// The calendar's query now, for the way back from a task or a date.
  query: string;
  dayHrefs: Record<string, string>;
};

export function CalendarGrid(props: Props) {
  const { showToast } = useToast();
  const [local, setLocal] = useState(props.tasks);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Re-seeded when what the server sent changed, keyed on ids and days
  // rather than on the array's identity, so an in-flight optimistic move
  // survives a re-render. The board does this in an effect; here it is
  // React's "adjust state while rendering", which saves a second render.
  const signature = props.tasks.map((t) => `${t.id}:${t.dueKey}`).join(",");
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setLocal(props.tasks);
  }

  const from = calendarFrom(props.query);

  const byDay = useMemo(() => {
    const map = new Map<string, { tasks: CalendarTask[]; dates: CalendarDate[] }>();
    for (const d of props.days) map.set(d, { tasks: [], dates: [] });
    for (const t of local) if (t.dueKey && map.has(t.dueKey)) map.get(t.dueKey)!.tasks.push(t);
    for (const d of props.dates) map.get(d.dayKey)?.dates.push(d);
    return map;
  }, [local, props.dates, props.days]);

  const undated = local.filter((t) => t.dueKey === null);
  // Read off the same local list, so a task dragged out of "באיחור" onto
  // a future day leaves the list the moment it lands.
  const overdue = local
    .filter((t) => t.dueKey !== null && t.dueKey < props.today)
    .sort((a, b) => (a.dueKey! < b.dueKey! ? -1 : a.dueKey! > b.dueKey! ? 1 : 0));

  async function save(task: CalendarTask, to: string | null, prev: string | null, withUndo: boolean) {
    setLocal((rows) => rows.map((t) => (t.id === task.id ? { ...t, dueKey: to } : t)));
    setPending(true);
    const result = await setTaskDueDateAction({ taskId: task.id, dueDate: to });
    setPending(false);
    if (!result.ok) {
      setLocal((rows) => rows.map((t) => (t.id === task.id ? { ...t, dueKey: prev } : t)));
      showToast({ tone: "error", title: "תאריך היעד לא השתנה", description: result.error });
      return;
    }
    showToast({
      tone: "success",
      title: to ? `${task.title}: יעד ${shortDate(to)}` : `${task.title}: בלי תאריך יעד`,
      ...(withUndo ? { undo: () => save({ ...task, dueKey: to }, prev, to, false) } : {}),
    });
  }

  function drop(to: string | null, id: string) {
    const task = local.find((t) => t.id === id);
    if (!task || task.dueKey === to) return;
    const fromKey = task.dueKey;
    if (task.clientVisible) {
      showToast({
        tone: "warning",
        title: "המשימה מוצגת ללקוח",
        description: `${task.title}. הלקוח יראה את התאריך החדש בפורטל.`,
        ask: {
          question: to ? `להזיז ל-${shortDate(to)}?` : "להסיר את תאריך היעד?",
          choices: [
            { value: "move", label: to ? "להזיז" : "להסיר" },
            { value: "cancel", label: "ביטול" },
          ],
          onAnswer: async (value) => {
            if (value === "move") await save(task, to, fromKey, true);
          },
        },
      });
      return;
    }
    void save(task, to, fromKey, true);
  }

  // Shared by every cell and by the drawer: where a drag may land.
  function dropZone(key: string): DropZone {
    return {
      onDragOver: (e: React.DragEvent) => {
        // Without preventDefault the browser refuses the drop and the
        // card springs back with no explanation.
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(key);
      },
      onDragLeave: () => setOver((s) => (s === key ? null : s)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(null);
        drop(key === "undated" ? null : key, e.dataTransfer.getData("text/plain"));
      },
    };
  }

  const item = (t: CalendarTask) => <TaskChip key={t.id} task={t} today={props.today} from={from} disabled={pending} />;
  const dateItem = (d: CalendarDate) => <DateChip key={`${d.id}:${d.dayKey}`} date={d} from={from} />;

  const anchorMonth = props.anchor.slice(0, 7);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1" data-testid="calendar-grid">
        {props.view === "day" ? (
          <section
            data-day={props.days[0]}
            {...dropZone(props.days[0])}
            className={`min-h-[320px] rounded-2xl border p-4 transition-colors ${over === props.days[0] ? "border-app-surface-nav bg-app-surface-sunken" : "border-app-border bg-white"}`}
          >
            <DayItems
              tasks={byDay.get(props.days[0])?.tasks ?? []}
              dates={byDay.get(props.days[0])?.dates ?? []}
              item={item}
              dateItem={dateItem}
              empty="אין משימות או מועדים ביום הזה."
            />
          </section>
        ) : (
          <>
            {/* Desk: the grid. Sunday is the first column, and in a
                right-to-left page that is the right edge, as on paper. */}
            <div className="hidden overflow-hidden rounded-2xl border border-app-border bg-app-border md:block">
              <div className={`grid gap-px ${GRID_COLUMNS}`}>
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="bg-cream-dim/40 px-2 py-1.5 text-center text-[12px] font-medium text-app-text-secondary">
                    {label}
                  </div>
                ))}
                {props.days.map((day) => {
                  const cell = byDay.get(day)!;
                  const items = [...cell.dates.map(dateItem), ...cell.tasks.map(item)];
                  const capped = props.view === "month" ? items.slice(0, MONTH_CELL_CAP) : items;
                  const outside = props.view === "month" && day.slice(0, 7) !== anchorMonth;
                  const weekend = new Date(`${day}T00:00:00Z`).getUTCDay() >= 5;
                  return (
                    <section
                      key={day}
                      data-day={day}
                      {...dropZone(day)}
                      className={`flex flex-col gap-1 p-1.5 transition-colors ${props.view === "month" ? "min-h-[118px]" : "min-h-[260px]"} ${
                        over === day
                          ? "bg-gold/10 outline outline-1 -outline-offset-1 outline-gold"
                          : outside
                            ? "bg-app-surface-sunken"
                            : day === props.today
                              ? "bg-app-surface-sunken"
                              : weekend
                                ? "bg-cream-dim/20"
                                : "bg-white"
                      }`}
                    >
                      <a
                        href={props.dayHrefs[day]}
                        draggable={false}
                        aria-label={`יום ${shortDate(day)}`}
                        className={`self-start rounded-full px-1.5 text-[12px] font-jbmono ${
                          day === props.today ? "bg-app-surface-nav text-cream" : outside ? "text-app-text-tertiary" : "text-app-text-secondary hover:text-app-text-primary"
                        }`}
                      >
                        {props.view === "week" ? shortDate(day) : dayOfMonth(day)}
                      </a>
                      {capped}
                      {items.length > capped.length && (
                        <a href={props.dayHrefs[day]} className="px-1 text-[11.5px] text-app-text-tertiary hover:text-app-text-primary">
                          ועוד {items.length - capped.length}
                        </a>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>

            {/* Phone: the same days as a list, only those with something
                in them and today. Seven columns do not fit 360px, and touch
                screens do not fire HTML5 drag events, so a due date is
                changed on the task's own screen there. */}
            <div className="space-y-3 md:hidden">
              {props.days
                .filter((day) => day === props.today || (byDay.get(day)!.tasks.length + byDay.get(day)!.dates.length > 0))
                .filter((day) => props.view !== "month" || day.slice(0, 7) === anchorMonth)
                .map((day) => (
                  <section key={day} className="rounded-2xl border border-app-border bg-white p-3">
                    <a href={props.dayHrefs[day]} className={`text-[13px] font-medium ${day === props.today ? "text-app-text-primary" : "text-app-text-secondary"}`}>
                      {WEEKDAY_LABELS[new Date(`${day}T00:00:00Z`).getUTCDay()]} {shortDate(day)}
                      {day === props.today ? " · היום" : ""}
                    </a>
                    <div className="mt-2">
                      <DayItems tasks={byDay.get(day)!.tasks} dates={byDay.get(day)!.dates} item={item} dateItem={dateItem} empty="אין כלום היום." />
                    </div>
                  </section>
                ))}
            </div>
          </>
        )}
      </div>

      {props.drawer && (
        <Drawer
          tab={props.drawer}
          hrefs={props.drawerHrefs}
          undated={undated}
          overdue={overdue}
          undatedMore={props.undatedMore}
          overdueMore={props.overdueMore}
          from={from}
          disabled={pending}
          over={over === "undated"}
          zone={dropZone("undated")}
        />
      )}
    </div>
  );
}

function DayItems({
  tasks,
  dates,
  item,
  dateItem,
  empty,
}: {
  tasks: CalendarTask[];
  dates: CalendarDate[];
  item: (t: CalendarTask) => React.ReactNode;
  dateItem: (d: CalendarDate) => React.ReactNode;
  empty: string;
}) {
  if (tasks.length + dates.length === 0) return <p className="text-[12.5px] text-app-text-tertiary">{empty}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {dates.map(dateItem)}
      {tasks.map(item)}
    </div>
  );
}

function TaskChip({ task, today, from, disabled }: { task: CalendarTask; today: string; from: string; disabled: boolean }) {
  const overdue = task.dueKey !== null && task.dueKey < today;
  return (
    <article
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-calendar-task={task.id}
      title={`${task.title} · ${task.clientName}${task.assigneeName ? ` · ${task.assigneeName}` : ""}${overdue ? " · באיחור" : ""}`}
      className="cursor-grab rounded-lg border border-app-border bg-white px-2 py-1 active:cursor-grabbing"
    >
      <div className="flex items-start gap-1.5">
        {/* Late is a dot, not a red card. A week with four late tasks
            used to be a red column that drowned out everything else on
            screen; the dot says the same thing and lets the week read. */}
        <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${overdue ? "bg-app-error" : PRIORITY_DOT[task.priority]}`} />
        {/* A plain anchor, like the board: a soft navigation to a task was
            being cancelled by the router. The link does not carry the
            drag; the chip does. Two lines at most: the whole title is in
            the tooltip and one click away. */}
        <a
          href={taskHref(task.id, from)}
          draggable={false}
          className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-snug text-app-text-primary [overflow-wrap:anywhere] hover:text-app-text-secondary"
        >
          {task.title}
        </a>
      </div>
      <p className="truncate ps-3 text-[11px] text-app-text-secondary">{task.clientName}</p>
    </article>
  );
}

/// The drawer: one of two lists, searchable, grouped by client.
///
/// Beside the grid and not over it, so nothing it is dragged onto is
/// hidden by it. 300px wide, rows up to two lines: one line cut most
/// titles to their first three words, and a task you cannot recognise is a
/// task you cannot place. The width stays 300 on purpose: 360 was tried
/// on 20.10.2026 and took from the grid exactly what this drawer exists
/// to give back (Ariel).
function Drawer({
  tab,
  hrefs,
  undated,
  overdue,
  undatedMore,
  overdueMore,
  from,
  disabled,
  over,
  zone,
}: {
  tab: CalendarDrawer;
  hrefs: { undated: string; overdue: string; close: string };
  undated: CalendarTask[];
  overdue: CalendarTask[];
  undatedMore: boolean;
  overdueMore: boolean;
  from: string;
  disabled: boolean;
  over: boolean;
  zone: DropZone;
}) {
  const [q, setQ] = useState("");
  const rows = tab === "undated" ? undated : overdue;
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((t) => `${t.title} ${t.clientName}`.toLowerCase().includes(needle)) : rows;

  // Grouped by client, the way the people using this think about work:
  // one client, one set of open loops. Groups in name order, rows in the
  // order the list already has (oldest first for "באיחור").
  const groups = new Map<string, CalendarTask[]>();
  for (const t of shown) groups.set(t.clientName, [...(groups.get(t.clientName) ?? []), t]);
  const ordered = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, "he"));

  const tabClass = (active: boolean) =>
    `flex-1 rounded-full px-3 py-1.5 text-center text-[12.5px] font-medium transition-colors ${
      active ? "border border-app-border bg-white text-app-text-primary" : "text-app-text-secondary hover:text-app-text-primary"
    }`;

  return (
    <aside
      data-testid="calendar-drawer"
      data-day="undated"
      {...zone}
      className={`flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border bg-white transition-colors lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-[300px] ${
        over ? "border-gold bg-gold/5" : "border-app-border"
      }`}
    >
      <div className="flex flex-col gap-2.5 border-b border-app-border p-3">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[14px] font-medium text-app-text-primary">{tab === "undated" ? "בלי תאריך יעד" : "באיחור"}</h2>
          <Link href={hrefs.close} aria-label="סגירת המגירה" data-testid="calendar-drawer-close" className="rounded-lg p-1.5 text-app-text-secondary hover:bg-cream-dim/40 hover:text-app-text-primary">
            <X size={16} strokeWidth={1.8} />
          </Link>
        </div>
        <div className="flex rounded-full bg-cream-dim/40 p-[3px]">
          <Link href={hrefs.undated} data-testid="calendar-drawer-tab-undated" className={tabClass(tab === "undated")} aria-current={tab === "undated" ? "page" : undefined}>
            בלי תאריך <span className="font-jbmono text-[11.5px]">{undated.length}{undatedMore ? "+" : ""}</span>
          </Link>
          <Link href={hrefs.overdue} data-testid="calendar-drawer-tab-overdue" className={tabClass(tab === "overdue")} aria-current={tab === "overdue" ? "page" : undefined}>
            באיחור <span className="font-jbmono text-[11.5px]">{overdue.length}{overdueMore ? "+" : ""}</span>
          </Link>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-app-border px-2.5 py-1.5 text-[13px] text-app-text-secondary focus-within:border-app-accent">
          <Search size={14} strokeWidth={1.8} />
          <span className="sr-only">חיפוש</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="חיפוש לפי משימה או לקוח"
            data-testid="calendar-drawer-search"
            className="min-w-0 flex-1 bg-transparent text-app-text-primary outline-none placeholder:text-app-text-tertiary"
          />
        </label>
        <p className="text-[11.5px] text-app-text-secondary">גוררים משימה ליום כדי לקבוע יעד. גרירה לכאן מסירה את היעד.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {ordered.map(([client, list]) => (
          <section key={client}>
            <h3 className="flex items-baseline gap-1.5 px-1.5 pb-1 pt-3 text-[11.5px] font-semibold tracking-wide text-app-text-secondary">
              {client}
              <span className="font-jbmono text-[11px] font-normal text-app-text-tertiary">{list.length}</span>
            </h3>
            {list.map((t) => (
              <DrawerRow key={t.id} task={t} from={from} disabled={disabled} showDue={tab === "overdue"} />
            ))}
          </section>
        ))}
        {shown.length === 0 && (
          <p className="px-1.5 py-4 text-[12.5px] text-app-text-tertiary">
            {needle ? "אין משימה שמתאימה לחיפוש." : tab === "undated" ? "לכל המשימות הפתוחות יש תאריך." : "אין משימות באיחור."}
          </p>
        )}
        {(tab === "undated" ? undatedMore : overdueMore) && (
          <Link href="/app/tasks" className="block px-1.5 pt-3 text-[12px] text-app-text-secondary hover:text-app-text-primary">
            יש עוד. לרשימת המשימות
          </Link>
        )}
      </div>
    </aside>
  );
}

function DrawerRow({ task, from, disabled, showDue }: { task: CalendarTask; from: string; disabled: boolean; showDue: boolean }) {
  return (
    <article
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-calendar-task={task.id}
      title={`${task.title} · ${task.clientName}`}
      className="group flex cursor-grab items-start gap-1.5 rounded-lg px-1.5 py-2 hover:bg-app-surface-sunken active:cursor-grabbing"
    >
      {/* The grip says "this moves" before anyone tries. */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="mt-[3px] shrink-0 text-app-text-tertiary group-hover:text-app-text-secondary">
        <circle cx="9" cy="6" r="1.6" />
        <circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" />
        <circle cx="15" cy="18" r="1.6" />
      </svg>
      <a href={taskHref(task.id, from)} draggable={false} className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-app-text-primary [overflow-wrap:anywhere] hover:text-app-text-secondary">
        {task.title}
      </a>
      {showDue && task.dueKey && (
        <span className="mt-[2px] flex shrink-0 items-center gap-1 font-jbmono text-[11px] text-app-error">
          <Clock size={11} strokeWidth={1.8} />
          {shortDate(task.dueKey)}
        </span>
      )}
    </article>
  );
}

function DateChip({ date, from }: { date: CalendarDate; from: string }) {
  return (
    <a
      href={`/app/important-dates/${date.id}?from=${encodeURIComponent(from)}`}
      draggable={false}
      data-calendar-date={date.id}
      title={`${date.title} · ${date.clientName}`}
      className="flex items-start gap-1.5 rounded-lg bg-gold/10 px-2 py-1 text-[12.5px] leading-snug text-app-text-primary hover:bg-gold/20"
    >
      <CalendarDays size={12} strokeWidth={1.8} className="mt-[3px] shrink-0 text-app-text-accent" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {date.title}
        <span className="block truncate text-[11px] text-app-text-tertiary">{date.clientName}</span>
      </span>
    </a>
  );
}
