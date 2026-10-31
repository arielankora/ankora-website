import type { TaskStatus } from "@prisma/client";
import type { ListRow } from "./TaskListProvider";

// Ariel, 31.10.2026: "אני רוצה אפשרות למיין את המשימות לפי כל אחת
// מהשדות: לדוגמה: תאריך, סטטוס, לקוח".
//
// Sorted in the browser, not by the query. listTasks returns the whole
// list with no page limit, so every row is already here, and a click on
// a column is instant rather than a server render of the slowest screen
// in the product. No sort chosen means the server's order (status,
// priority, deadline), which stays the default.
//
// In the address as `?sort=due` or `?sort=-due` (descending), so the way
// back from a task returns to the same order (list-query.ts carries it).

export const SORT_KEYS = ["client", "title", "due", "assignee", "status", "supervisor"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = { key: SortKey; desc: boolean } | null;

export const SORT_LABELS: Record<SortKey, string> = {
  client: "לקוח",
  title: "משימה",
  due: "תאריך",
  assignee: "אחראי",
  status: "סטטוס",
  supervisor: "מפקח",
};

/// The order a person reads statuses in, the same as the row's select:
/// not yet started, in hand, waiting, finished. Alphabetical would put
/// "בארכיון" first.
const STATUS_ORDER: Record<TaskStatus, number> = {
  OPEN: 0,
  IN_PROGRESS: 1,
  PENDING_APPROVAL: 2,
  DONE: 3,
  ARCHIVED: 4,
};

export function parseSort(value: string | null | undefined): Sort {
  if (!value) return null;
  const desc = value.startsWith("-");
  const key = (desc ? value.slice(1) : value) as SortKey;
  return SORT_KEYS.includes(key) ? { key, desc } : null;
}

export function sortParam(sort: Sort): string | null {
  return sort ? `${sort.desc ? "-" : ""}${sort.key}` : null;
}

/// One click goes up, the second down, the third back to the default.
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current?.key !== key) return { key, desc: false };
  return current.desc ? null : { key, desc: true };
}

const collator = new Intl.Collator("he", { sensitivity: "base", numeric: true });

function valueOf(row: ListRow, key: SortKey): string | number | null {
  switch (key) {
    case "client":
      return row.clientName;
    case "title":
      return row.title;
    case "due":
      return row.dueDate ? Date.parse(row.dueDate) : null;
    case "assignee":
      return row.assignedToName;
    case "status":
      return STATUS_ORDER[row.status];
    case "supervisor":
      return row.supervisorName;
  }
}

/// A stable sort, so rows that tie keep the server's order among
/// themselves: sorted by client, each client's urgent work is still on
/// top. Empty values (no date, no assignee) go last in both directions,
/// since "nobody" is not the first or the last name in the alphabet.
export function sortRows(rows: ListRow[], sort: Sort): ListRow[] {
  if (!sort) return rows;
  const sign = sort.desc ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row, sort.key) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      const diff =
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value));
      return diff === 0 ? a.index - b.index : diff * sign;
    })
    .map((entry) => entry.row);
}
