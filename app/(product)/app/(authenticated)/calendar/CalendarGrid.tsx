"use client";
import Link from "next/link";
import { CalendarDays, Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { taskHref } from "../tasks/list-query";
import { setTaskDueDateAction } from "./actions";
import { calendarFrom, dayOfMonth, shortDate, WEEKDAY_LABELS, type CalendarView } from "@/lib/calendar-keys";
import type { CalendarDate, CalendarTask } from "@/lib/app-domain/calendar";

// The calendar's grid and its side panel of undated tasks.
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

/// Items a month cell draws before "ועוד N". A month cell is a glance,
/// not a list; the day view is the list.
const MONTH_CELL_CAP = 4;

const PRIORITY_DOT: Record<CalendarTask["priority"], string> = {
  LOW: "bg-transparent",
  NORMAL: "bg-transparent",
  HIGH: "bg-warning",
  URGENT: "bg-error",
};

type Props = {
  view: CalendarView;
  anchor: string;
  today: string;
  days: string[];
  /// Dated and undated together. `dueKey: null` is the side panel.
  tasks: CalendarTask[];
  dates: CalendarDate[];
  showTasks: boolean;
  undatedCapped: boolean;
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

  // Shared by every cell and by the panel: where a drag may land.
  function dropZone(key: string) {
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
      <div className="min-w-0 flex-1">
        {props.view === "day" ? (
          <section
            data-day={props.days[0]}
            {...dropZone(props.days[0])}
            className={`min-h-[320px] rounded-2xl border p-4 transition-colors ${over === props.days[0] ? "border-appNavy bg-appNavy/[0.04]" : "border-lineDark bg-white"}`}
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
            <div className="hidden overflow-hidden rounded-2xl border border-lineDark bg-lineDark md:block">
              <div className="grid grid-cols-7 gap-px">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="bg-cream-dim/40 px-2 py-1.5 text-center text-[12px] font-medium text-appNavy/55">
                    {label}
                  </div>
                ))}
                {props.days.map((day) => {
                  const cell = byDay.get(day)!;
                  const items = [...cell.dates.map(dateItem), ...cell.tasks.map(item)];
                  const capped = props.view === "month" ? items.slice(0, MONTH_CELL_CAP) : items;
                  const outside = props.view === "month" && day.slice(0, 7) !== anchorMonth;
                  return (
                    <section
                      key={day}
                      data-day={day}
                      {...dropZone(day)}
                      className={`flex flex-col gap-1 p-1.5 transition-colors ${props.view === "month" ? "min-h-[118px]" : "min-h-[260px]"} ${
                        over === day ? "bg-appNavy/[0.06]" : outside ? "bg-cream-dim/30" : "bg-white"
                      }`}
                    >
                      <a
                        href={props.dayHrefs[day]}
                        draggable={false}
                        aria-label={`יום ${shortDate(day)}`}
                        className={`self-start rounded-full px-1.5 text-[12px] font-jbmono ${
                          day === props.today ? "bg-appNavy text-cream" : outside ? "text-appNavy/35" : "text-appNavy/60 hover:text-appNavy"
                        }`}
                      >
                        {props.view === "week" ? shortDate(day) : dayOfMonth(day)}
                      </a>
                      {capped}
                      {items.length > capped.length && (
                        <a href={props.dayHrefs[day]} className="px-1 text-[11.5px] text-appNavy/50 hover:text-appNavy">
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
                  <section key={day} className="rounded-2xl border border-lineDark bg-white p-3">
                    <a href={props.dayHrefs[day]} className={`text-[13px] font-medium ${day === props.today ? "text-appNavy" : "text-appNavy/60"}`}>
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

      {props.showTasks && (
        <aside
          data-testid="calendar-undated"
          data-day="undated"
          {...dropZone("undated")}
          className={`w-full shrink-0 rounded-2xl border p-3 transition-colors lg:sticky lg:top-4 lg:w-72 ${
            over === "undated" ? "border-appNavy bg-appNavy/[0.04]" : "border-lineDark bg-cream-dim/30"
          }`}
        >
          <h2 className="flex items-center gap-2 px-1 pb-1 text-[13px] font-medium text-appNavy">
            <Inbox size={14} strokeWidth={1.8} />
            בלי תאריך יעד
            <span className="font-jbmono text-[11px] text-appNavy/45">{undated.length}{props.undatedCapped ? "+" : ""}</span>
          </h2>
          <p className="px-1 pb-2 text-[11.5px] text-appNavy/45">גוררים משימה ליום כדי לקבוע לה יעד. גרירה לכאן מסירה את היעד.</p>
          <div className="flex flex-col gap-1.5">
            {undated.map(item)}
            {undated.length === 0 && <p className="px-1 py-2 text-[12px] text-appNavy/35">לכל המשימות הפתוחות יש תאריך.</p>}
            {props.undatedCapped && (
              <Link href="/app/tasks" className="px-1 text-[11.5px] text-appNavy/50 hover:text-appNavy">
                יש עוד. לרשימת המשימות
              </Link>
            )}
          </div>
        </aside>
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
  if (tasks.length + dates.length === 0) return <p className="text-[12.5px] text-appNavy/40">{empty}</p>;
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
      title={`${task.title} · ${task.clientName}${task.assigneeName ? ` · ${task.assigneeName}` : ""}`}
      className={`cursor-grab rounded-lg border bg-white px-2 py-1 active:cursor-grabbing ${overdue ? "border-error/40" : "border-lineDark"}`}
    >
      <div className="flex items-start gap-1.5">
        <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} />
        {/* A plain anchor, like the board: a soft navigation to a task was
            being cancelled by the router. The link does not carry the
            drag; the chip does. */}
        <a
          href={taskHref(task.id, from)}
          draggable={false}
          className={`min-w-0 flex-1 text-[12.5px] leading-snug [overflow-wrap:anywhere] hover:text-appNavy/70 ${overdue ? "text-error" : "text-appNavy"}`}
        >
          {task.title}
        </a>
      </div>
      <p className="truncate ps-3 text-[11px] text-appNavy/45">{task.clientName}</p>
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
      className="flex items-start gap-1.5 rounded-lg bg-gold/10 px-2 py-1 text-[12.5px] leading-snug text-appNavy hover:bg-gold/20"
    >
      <CalendarDays size={12} strokeWidth={1.8} className="mt-[3px] shrink-0 text-gold-dim" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {date.title}
        <span className="block truncate text-[11px] text-appNavy/45">{date.clientName}</span>
      </span>
    </a>
  );
}
