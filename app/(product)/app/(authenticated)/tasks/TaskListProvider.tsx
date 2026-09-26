"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CreatedTaskRow } from "./actions";

// The list holds its own rows, and a task that was just created is
// handed to it rather than fetched.
//
// ## Why this exists
//
// Five investigations, fifteen CI rounds and three weeks went into the
// question "why does the new row sometimes not appear". Everything that
// could be measured was: the write always lands, the server always
// re-renders and always sees the row, and the request that was supposed
// to bring it back is sent every time and cancelled some of the time.
// Ownership was moved, timing was changed, a transition was added, and
// the refresh was replaced with a navigation. Each one reduced the
// frequency. None of them removed it, and the last measurement showed
// the navigation being cancelled too, at 38ms - because `router.replace`
// in the App Router is not a document load, it is an RSC fetch, and it
// is cancellable in exactly the same way.
//
// So this stops asking. The action already wrote the row and already
// knows what it wrote; it returns it, and the list puts it on the
// screen. A row that arrives with the write cannot be cancelled, raced
// or delayed. There is nothing left to go wrong because there is
// nothing left in flight.
//
// ## What this is not
//
// Not a cache, and not a client-side copy of the list. The server is
// still the only thing that decides what is in this list: every filter,
// every sort and every other tab reads from it, `revalidatePath` still
// runs, and the rows below are re-seeded from the server the moment it
// sends different ones. This holds exactly one thing the server has not
// had a chance to say yet, for the few hundred milliseconds before it
// says it.
//
// ## The one honest limitation
//
// A task created while a filter is on may not belong in the filtered
// list at all - a new task is OPEN, so creating one while "הושלמו" is
// selected would put a row on screen that the next render correctly
// removes. `accepts` below is where that is decided, and it is decided
// on the same fields the query uses rather than guessed.

type TaskListValue = {
  /// Everything the server sent, plus anything it has not had a chance
  /// to send yet. Read by the view; never by the page.
  rows: ListRow[];
  /// Called by the create form with what the action returned.
  addCreated: (task: CreatedTaskRow) => void;
};

const TaskListContext = createContext<TaskListValue>({ rows: [], addCreated: () => {} });

export function useTaskList() {
  return useContext(TaskListContext);
}

export type ListRow = CreatedTaskRow;

/// Whether a freshly created task belongs in the list as it is filtered
/// right now.
///
/// Deliberately narrow: only the filters a new task can fail. It is
/// always OPEN, carries whatever client the form set, and since
/// 26.9.2026 may be born on somebody else, so status, client and "שלי"
/// are the filters that can put it out of view. Search is not checked here - a person who just typed a title is
/// not searching for something else at the same time, and guessing at
/// the server's matching rules in the browser is how the two drift.
function accepts(row: ListRow, filters: ListFilters): boolean {
  if (filters.status && filters.status !== row.status) return false;
  if (filters.clientId && filters.clientName && filters.clientName !== row.clientName) return false;
  if (filters.involvedUserId && filters.involvedUserId !== row.assignedToId && filters.involvedUserId !== row.supervisorId)
    return false;
  return true;
}

type ListFilters = {
  status?: string;
  clientId?: string;
  clientName?: string;
  /// Set while "שלי" is on: only tasks this person is the assignee or
  /// the supervisor of belong.
  involvedUserId?: string;
};

/// `children` is a plain ReactNode and NOT a render prop, which is not a
/// style preference.
///
/// Every `page.tsx` on this screen is a Server Component, and a function
/// cannot cross the server/client boundary as a prop: only serializable
/// values and React elements can. The first version of this file took
/// `(rows) => ReactNode` and type-checked, linted and built without a
/// word of complaint, then failed at runtime on every render of the
/// tasks screen. `Drawer.tsx` has carried a comment about this exact
/// trap since the redesign; I wrote the trap anyway.
///
/// So the merged rows go out through the context instead, and the view
/// below reads them from there.
export function TaskListProvider({
  rows,
  filters,
  children,
}: {
  rows: ListRow[];
  filters: ListFilters;
  children: ReactNode;
}) {
  const [extra, setExtra] = useState<ListRow[]>([]);

  // Everything the server sent, plus anything it has not had a chance to
  // send yet, with the server winning on any id it already knows. That
  // ordering is what makes this self-cleaning: the moment a revalidation
  // lands, the locally held row is the same row and disappears from
  // `extra` on the next effect.
  const signature = useMemo(() => rows.map((r) => r.id).join(","), [rows]);
  useEffect(() => {
    setExtra((prev) => prev.filter((row) => !rows.some((r) => r.id === row.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Newest first, above everything the server sent. A task somebody just
  // created belongs at the top whatever the sort says: they are looking
  // for confirmation that it exists, not for where it ranks.
  const all = useMemo(() => [...extra, ...rows], [extra, rows]);

  const value = useMemo<TaskListValue>(
    () => ({
      rows: all,
      addCreated: (task) => {
        if (!accepts(task, filters)) return;
        setExtra((prev) => (prev.some((r) => r.id === task.id) ? prev : [task, ...prev]));
      },
    }),
    [all, filters]
  );

  return <TaskListContext.Provider value={value}>{children}</TaskListContext.Provider>;
}
