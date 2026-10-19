// The calendar screen's arithmetic, on day keys only.
//
// Every value here is a `YYYY-MM-DD` key that is ALREADY an Israel
// calendar day (the server turns instants into keys with localDateKey).
// Adding days to a key is plain calendar arithmetic, so it is done on a
// UTC date built from the key, where no DST change can move it. No
// timezone, no `server-only`: the client component imports this too, to
// know which keys the grid draws and where "next week" goes.

import { mineParam, type MineScope } from "@/app/(product)/app/(authenticated)/tasks/mine-scope";

export type CalendarView = "day" | "week" | "month";
export type CalendarShow = "all" | "tasks" | "dates";

export const CALENDAR_VIEWS: { view: CalendarView; label: string }[] = [
  { view: "day", label: "יום" },
  { view: "week", label: "שבוע" },
  { view: "month", label: "חודש" },
];

export const CALENDAR_SHOWS: { show: CalendarShow; label: string }[] = [
  { show: "all", label: "הכול" },
  { show: "tasks", label: "משימות" },
  { show: "dates", label: "מועדים" },
];

/// Sunday first: the Israeli week, and the week the rest of the app uses.
export const WEEKDAY_LABELS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !KEY_RE.test(value)) return false;
  const d = keyToUtc(value);
  return !isNaN(d.getTime()) && utcToKey(d) === value;
}

function keyToUtc(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

function utcToKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToKey(d);
}

/// 0 = Sunday.
export function weekday(key: string): number {
  return keyToUtc(key).getUTCDay();
}

/// Same day-of-month, `months` later, clamped to the month's last day:
/// "next month" from 31 January is 28 or 29 February, not 3 March.
export function addMonths(key: string, months: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return utcToKey(first);
}

export function parseView(value?: string | null): CalendarView {
  return value === "day" || value === "month" ? value : "week";
}

export function parseShow(value?: string | null): CalendarShow {
  return value === "tasks" || value === "dates" ? value : "all";
}

/// The days the grid draws for a view, first to last.
///
/// A month is drawn as whole weeks, Sunday to Saturday, so the grid is
/// always a rectangle and a task due on the 30th of last month is still
/// visible (and droppable) on the first row.
export function visibleDays(view: CalendarView, anchor: string): string[] {
  if (view === "day") return [anchor];
  let start: string;
  let count: number;
  if (view === "week") {
    start = addDays(anchor, -weekday(anchor));
    count = 7;
  } else {
    const first = `${anchor.slice(0, 7)}-01`;
    const last = addDays(addMonths(first, 1), -1);
    start = addDays(first, -weekday(first));
    const end = addDays(last, 6 - weekday(last));
    count = Math.round((keyToUtc(end).getTime() - keyToUtc(start).getTime()) / 86_400_000) + 1;
  }
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/// Where "previous" and "next" go from `anchor`.
export function shiftAnchor(view: CalendarView, anchor: string, direction: 1 | -1): string {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  return addMonths(anchor, direction);
}

const MONTH_FMT = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_FMT = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_FMT = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "UTC" });

/// The heading over the grid: "אוקטובר 2026", "18.10 עד 24.10", or the
/// full day.
export function rangeTitle(view: CalendarView, anchor: string): string {
  if (view === "day") return DAY_FMT.format(keyToUtc(anchor));
  if (view === "month") return MONTH_FMT.format(keyToUtc(anchor));
  const days = visibleDays("week", anchor);
  return `${SHORT_FMT.format(keyToUtc(days[0]))} עד ${SHORT_FMT.format(keyToUtc(days[6]))}`;
}

export function shortDate(key: string): string {
  return SHORT_FMT.format(keyToUtc(key));
}

export function dayOfMonth(key: string): number {
  return Number(key.slice(8, 10));
}

/// The calendar's own URL. Defaults are left out, so a bare
/// /app/calendar is "this week, everything, mine".
export type CalendarState = {
  view: CalendarView;
  date: string;
  show: CalendarShow;
  clientId?: string;
  /// Whose work, in the tasks screen's own four words and URL values
  /// (mine-scope.ts): absent or `1` = "שלי", `assigned`, `supervising`,
  /// `0` = everyone. 20.10.2026: the calendar had only "שלי" and "כולם".
  mine: MineScope;
  /// 20.10.2026: the drawer, and which of its two lists. Absent = closed,
  /// which is the default: the grid gets the whole width until somebody
  /// is planning.
  drawer?: CalendarDrawer;
};

export type CalendarDrawer = "undated" | "overdue";

export function parseDrawer(value?: string | null): CalendarDrawer | undefined {
  return value === "undated" || value === "overdue" ? value : undefined;
}

export function calendarHref(state: CalendarState, today: string): string {
  const p = new URLSearchParams();
  if (state.view !== "week") p.set("view", state.view);
  if (state.date !== today) p.set("date", state.date);
  if (state.show !== "all") p.set("show", state.show);
  if (state.clientId) p.set("clientId", state.clientId);
  const mine = mineParam(state.mine);
  if (mine) p.set("mine", mine);
  if (state.drawer) p.set("drawer", state.drawer);
  const qs = p.toString();
  return qs ? `/app/calendar?${qs}` : "/app/calendar";
}

/// The calendar's own keys, the only ones carried in a `from` link.
export const CALENDAR_QUERY_KEYS = ["view", "date", "show", "clientId", "mine", "drawer"] as const;

/// Prefix of a `from` value that points back at the calendar rather than
/// at the tasks list. See list-query.ts.
export const CALENDAR_FROM_PREFIX = "calendar:";

/// The calendar's current query, cleaned to its own keys. Treated as
/// input: it comes back off the address bar of the next screen.
export function cleanCalendarQuery(query: string): string {
  const input = new URLSearchParams(query);
  const out = new URLSearchParams();
  for (const key of CALENDAR_QUERY_KEYS) {
    const value = input.get(key);
    if (value && value.length <= 200) out.set(key, value);
  }
  return out.toString();
}

/// `from` for a link the calendar hands out.
export function calendarFrom(query: string): string {
  return `${CALENDAR_FROM_PREFIX}${cleanCalendarQuery(query)}`;
}

/// The calendar's address from such a `from`, or null when it is not one.
export function calendarBackHref(from?: string | null): string | null {
  if (!from || !from.startsWith(CALENDAR_FROM_PREFIX)) return null;
  const query = cleanCalendarQuery(from.slice(CALENDAR_FROM_PREFIX.length));
  return query ? `/app/calendar?${query}` : "/app/calendar";
}
