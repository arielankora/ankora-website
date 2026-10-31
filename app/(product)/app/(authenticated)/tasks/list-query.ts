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
//
// 19.10.2026: or under /app/calendar. A task opened from the calendar
// carries `from=calendar:<its query>` (see lib/calendar-keys.ts), and
// "back" returns to the same view, day and filters.

import { calendarBackHref, CALENDAR_FROM_PREFIX, cleanCalendarQuery } from "@/lib/calendar-keys";

/// Every key the tasks list reads. A filter added to page.tsx that is
/// not listed here is simply not carried back, which is the safe way to
/// fail.
export const LIST_QUERY_KEYS = ["clientId", "categoryId", "status", "mine", "closed", "q", "group", "view", "sort"] as const;

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
  const calendar = calendarBackHref(from);
  if (calendar) return calendar;
  const query = clean(new URLSearchParams(from));
  return query ? `/app/tasks?${query}` : "/app/tasks";
}

/// The `from` to hand on from a task screen to the next task it links
/// to (a step), so the way back still leads to the same list.
export function carriedListQuery(from?: string | null): string {
  if (from && from.startsWith(CALENDAR_FROM_PREFIX)) {
    return `${CALENDAR_FROM_PREFIX}${cleanCalendarQuery(from.slice(CALENDAR_FROM_PREFIX.length))}`;
  }
  return from ? clean(new URLSearchParams(from)) : "";
}

/// The words on the way back: the calendar or the list.
export function backLabel(from?: string | null): string {
  return calendarBackHref(from) ? "חזרה ליומן" : "חזרה למשימות";
}

/// 19.10.2026: the words on the way back name the list as it was, so a
/// person sees which list they return to before they click: "משימות ·
/// שלי · <client> · "<search>"". Names come from the caller, already
/// resolved against what this person may see (an id they cannot reach
/// arrives as undefined and is left out, so the label never names a
/// client the list itself would not show). Anything not set says nothing.
export const STATUS_WORDS: Record<string, string> = {
  ACTIVE: "פעילות",
  OPEN: "פתוחות",
  IN_PROGRESS: "בטיפול",
  PENDING_APPROVAL: "ממתינות לאישור",
  DONE: "הושלמו",
};
const MINE_WORDS: Record<string, string> = { "0": "כולם", assigned: "לביצוע", supervising: "בפיקוח" };

export function backTitle(from: string | null | undefined, names: { client?: string; category?: string } = {}): string {
  if (calendarBackHref(from)) return "יומן";
  const q = new URLSearchParams(from ? clean(new URLSearchParams(from)) : "");
  const parts = ["משימות"];
  const mine = q.get("mine");
  parts.push(mine && MINE_WORDS[mine] ? MINE_WORDS[mine] : "שלי");
  const status = q.get("status");
  if (status && STATUS_WORDS[status]) parts.push(STATUS_WORDS[status]);
  if (q.get("clientId") && names.client) parts.push(names.client);
  if (q.get("categoryId") && names.category) parts.push(names.category);
  const text = q.get("q")?.trim();
  if (text) parts.push(`"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`);
  if (q.get("view") === "board") parts.push("לוח");
  return parts.join(" · ");
}
