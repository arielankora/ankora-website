"use client";
import { ArrowDown, ArrowUp, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/app/states/EmptyState";
import { TaskRow } from "./TaskRow";
import { TaskBoard } from "./TaskBoard";
import { useTaskList, type ListRow } from "./TaskListProvider";
import type { MineScope } from "./mine-scope";
import { SORT_KEYS, SORT_LABELS, nextSort, parseSort, sortParam, type SortKey } from "./task-sort";

// Everything below the filter bar on the tasks screen: the empty state,
// the board, the grouped list and the flat list.
//
// A client component, and every prop it takes is a primitive. The rows
// come from the context rather than from a prop, which is what lets the
// page stay a Server Component while the rows themselves are held in the
// browser and can gain one the moment it is created.

/// The empty list, said in the terms of the filter that emptied it.
const EMPTY: Record<MineScope, { title: string; description: string }> = {
  involved: {
    title: "אין משימות פתוחות עליך",
    description: "כשמשימה תשויך אליך או תחכה לאישורך היא תופיע כאן. \"כולם\" מציג את כל המשימות.",
  },
  assigned: {
    title: "אין משימות לביצוע שלך",
    description: "כשמשימה תשויך אליך היא תופיע כאן. \"כולם\" מציג את כל המשימות.",
  },
  supervising: {
    title: "אין משימות בפיקוחך",
    description: "כשתוגדר כמפקח על משימה היא תופיע כאן. \"כולם\" מציג את כל המשימות.",
  },
  all: {
    title: "אין עדיין משימות",
    description: "הוספת משימה ראשונה תופיע כאן, לפי הלקוח והקטגוריה שבחרתם.",
  },
};

export function TaskListView({
  board,
  grouped,
  mineScope,
  q,
}: {
  board: boolean;
  grouped: boolean;
  mineScope: MineScope;
  q?: string;
}) {
  const { rows } = useTaskList();

  if (rows.length === 0) {
    // Three different nothings, and they mean three different things. A
    // search that found nothing is not a product with no tasks in it,
    // and telling somebody "אין עדיין משימות" when their colleagues have
    // forty open is simply wrong.
    return (
      <EmptyState
        icon={ListChecks}
        title={q ? "לא נמצאו משימות" : EMPTY[mineScope].title}
        description={
          q
            ? `אין משימה שמכילה "${q}" בכותרת, בתיאור, בשרשור או בשם הלקוח. אפשר לנקות את החיפוש או לוותר על אחד המסננים.`
            : EMPTY[mineScope].description
        }
      />
    );
  }

  if (board) {
    return (
      <TaskBoard
        // Fed from the same rows as the list, so a task created while the
        // board is open appears on it too. The board is a different view
        // of this list, not a different list.
        cards={rows.map((row) => ({
          id: row.id,
          title: row.title,
          clientName: row.clientName,
          status: row.status,
          priority: row.priority,
          blockedOn: row.blockedOn,
          blockedSince: row.blockedSince,
          dueDate: row.dueDate,
          assignedToName: row.assignedToName,
          supervisorName: row.supervisorName,
          clientVisible: row.clientVisible,
          // The board needs to know WHETHER there is an outcome, not what
          // it says: that is the difference between asking for the
          // sentence before a card lands on "הושלמו" and being refused
          // after it does.
          hasOutcome: Boolean(row.clientOutcome?.trim()),
        }))}
      />
    );
  }

  if (grouped) {
    return (
      <div className="space-y-5">
        <SortSelect />
        {groupByClient(rows).map(([clientName, inClient]) => (
          <section key={clientName}>
            <h2 className="text-sm font-medium text-app-text-primary">
              {clientName}
              <span className="mr-2 font-normal text-app-text-tertiary">{inClient.length}</span>
            </h2>
            <div className="mt-2 rounded-2xl border border-app-border bg-white">
              <ColumnHeader />
              <div className="divide-y divide-app-border">
                {inClient.map((row) => (
                  <TaskRow key={row.id} task={row} />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    // The header sits outside the divided list: a hidden first child
    // still counts for `divide-y`, and gave the first card a stray top
    // border on a phone.
    <div className="space-y-3">
      <SortSelect />
      <div className="rounded-2xl border border-app-border bg-white">
        <ColumnHeader />
        <div className="divide-y divide-app-border">
          {rows.map((row) => (
            <TaskRow key={row.id} task={row} />
          ))}
        </div>
      </div>
    </div>
  );
}

/// The sort on a phone, where there is no header to click.
///
/// Below xl the rows are cards and the column names are hidden, so the
/// same choice is a select. One value per column and direction, plus the
/// default; from xl it is hidden and the header does the job.
function SortSelect() {
  const { sort, setSort } = useTaskList();
  return (
    <label className="flex w-fit items-center gap-2 rounded-full border border-app-border bg-white px-3 py-1.5 text-[13px] text-app-text-secondary xl:hidden">
      מיון
      <select
        aria-label="מיון"
        value={sortParam(sort) ?? ""}
        onChange={(e) => setSort(parseSort(e.target.value))}
        className="bg-transparent text-app-text-primary outline-none"
      >
        <option value="">ברירת מחדל</option>
        {SORT_KEYS.flatMap((key) => [
          <option key={key} value={key}>
            {SORT_LABELS[key]}, {key === "due" ? "מהמוקדם" : key === "status" ? "מפתוחות" : "א-ת"}
          </option>,
          <option key={`-${key}`} value={`-${key}`}>
            {SORT_LABELS[key]}, {key === "due" ? "מהמאוחר" : key === "status" ? "מהושלמו" : "ת-א"}
          </option>,
        ])}
      </select>
    </label>
  );
}

/// Column names for the one-line-per-task layout, from xl up only.
///
/// The same grid template as TaskRow's xl arrangement, so the labels sit
/// over their columns. Below xl every value on the card carries its own
/// label ("אחראי:", "מפקח:") or is self-evident (a client, a date), and
/// a header over a stack of cards would label nothing.
///
/// 31.10.2026: each name is a button that sorts by its column (see
/// task-sort.ts), with an arrow on the one in use.
function ColumnHeader() {
  return (
    <div
      data-testid="task-columns"
      className="hidden border-b border-app-border grid-cols-[20px_minmax(0,130px)_minmax(0,1fr)_56px_minmax(0,110px)_128px_minmax(0,110px)_64px] items-center gap-x-3 px-[18px] py-2 text-[11px] font-medium text-app-text-tertiary xl:grid"
    >
      <span />
      <SortButton column="client" />
      <SortButton column="title" />
      <SortButton column="due" end />
      <SortButton column="assignee" />
      <SortButton column="status" />
      <SortButton column="supervisor" />
      <span />
    </div>
  );
}

function SortButton({ column, end = false }: { column: SortKey; end?: boolean }) {
  const { sort, setSort } = useTaskList();
  const active = sort?.key === column;
  const Arrow = sort?.desc ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => setSort(nextSort(sort, column))}
      aria-label={
        active ? `${SORT_LABELS[column]}, ממוין ${sort.desc ? "בסדר יורד" : "בסדר עולה"}` : `מיון לפי ${SORT_LABELS[column]}`
      }
      className={`flex min-w-0 items-center gap-1 hover:text-app-text-primary ${end ? "justify-self-end" : "justify-self-start"} ${
        active ? "text-app-text-primary" : ""
      }`}
    >
      <span>{SORT_LABELS[column]}</span>
      {active && <Arrow size={12} strokeWidth={2} aria-hidden />}
    </button>
  );
}

/// Grouped in the order the query already produced, so within a client
/// the urgent work is still on top. The groups themselves are ordered by
/// the client whose most urgent task comes first, not alphabetically:
/// the point of this view is to see which account needs attention, and
/// sorting by name would bury that under the alphabet.
function groupByClient(rows: ListRow[]) {
  const groups = new Map<string, ListRow[]>();
  for (const row of rows) {
    const found = groups.get(row.clientName);
    if (found) found.push(row);
    else groups.set(row.clientName, [row]);
  }
  return [...groups.entries()];
}
