"use client";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/app/states/EmptyState";
import { TaskRow } from "./TaskRow";
import { TaskBoard } from "./TaskBoard";
import { useTaskList, type ListRow } from "./TaskListProvider";

// Everything below the filter bar on the tasks screen: the empty state,
// the board, the grouped list and the flat list.
//
// A client component, and every prop it takes is a primitive. The rows
// come from the context rather than from a prop, which is what lets the
// page stay a Server Component while the rows themselves are held in the
// browser and can gain one the moment it is created.

export function TaskListView({
  board,
  grouped,
  mine,
  q,
}: {
  board: boolean;
  grouped: boolean;
  mine: boolean;
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
        title={q ? "לא נמצאו משימות" : mine ? "אין משימות פתוחות עליך" : "אין עדיין משימות"}
        description={
          q
            ? `אין משימה שמכילה "${q}" בכותרת, בתיאור, בשרשור או בשם הלקוח. אפשר לנקות את החיפוש או לוותר על אחד המסננים.`
            : mine
              ? "כשמשימה תשויך אליך היא תופיע כאן. אפשר לכבות את המסנן כדי לראות את כל המשימות."
              : "הוספת משימה ראשונה תופיע כאן, לפי הלקוח והקטגוריה שבחרתם."
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
          dueDate: row.dueDate,
          assignedToName: row.assignedToName,
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
        {groupByClient(rows).map(([clientName, inClient]) => (
          <section key={clientName}>
            <h2 className="text-sm font-medium text-appNavy">
              {clientName}
              <span className="mr-2 font-normal text-appNavy/45">{inClient.length}</span>
            </h2>
            <div className="mt-2 divide-y divide-lineDark rounded-2xl border border-lineDark bg-white">
              {inClient.map((row) => (
                <TaskRow key={row.id} task={row} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="divide-y divide-lineDark rounded-2xl border border-lineDark bg-white">
      {rows.map((row) => (
        <TaskRow key={row.id} task={row} />
      ))}
    </div>
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
