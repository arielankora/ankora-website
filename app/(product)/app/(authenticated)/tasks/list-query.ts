// The way back from a task to the list it was opened from.
//
// Ariel, 7.10.2026: opening a task and then wanting the list again meant
// the breadcrumb or the sidebar, and both go to a bare /app/tasks: the
// defaults, not the client, search and pills that were on screen a
// second ago. Narrowing the list is the work; losing it on every task
// opened made the filters cost more than they saved.
//
// So the list's own query travels with the link, as `?from=`, and the
// task screen turns it back into the list's address. In the URL and not
// in browser storage: it survives a reload of the task, a second tab and
// a link pasted to a colleague, and there is nothing to go stale.
//
// Only the list's own keys survive the trip. `from` is read off the
// address bar, so it is treated as input: anything else is dropped, and
// the result is always a path under /app/tasks, never somewhere else.

/// Every key the tasks list reads. A filter added to page.tsx that is
/// not listed here is simply not carried back, which is the safe way to
/// fail.
export const LIST_QUERY_KEYS = ["clientId", "categoryId", "status", "mine", "closed", "q", "group", "view"] as const;

function clean(input: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const key of LIST_QUERY_KEYS) {
    const value = input.get(key);
    // A bound on length so a crafted link cannot grow the next one
    // without limit. Real values are ids, enum words and a search box.
    if (value && value.length <= 200) out.set(key, value);
  }
  return out.toString();
}

/// The list's current state as a query string, from the page's own
/// searchParams. Empty when the list is on its defaults.
export function listQueryOf(searchParams: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const key of LIST_QUERY_KEYS) {
    const value = searchParams[key];
    if (typeof value === "string") params.set(key, value);
  }
  return clean(params);
}

/// A task's address, remembering the list it was opened from.
export function taskHref(id: string, listQuery?: string | null): string {
  return listQuery ? `/app/tasks/${id}?from=${encodeURIComponent(listQuery)}` : `/app/tasks/${id}`;
}

/// The list to go back to, from a task screen's `from`. The defaults
/// when there is none or nothing in it survives.
export function tasksListHref(from?: string | null): string {
  if (!from) return "/app/tasks";
  const query = clean(new URLSearchParams(from));
  return query ? `/app/tasks?${query}` : "/app/tasks";
}

/// The `from` to hand on from a task screen to the next task it links
/// to (a step), so the way back still leads to the same list.
export function carriedListQuery(from?: string | null): string {
  return from ? clean(new URLSearchParams(from)) : "";
}
