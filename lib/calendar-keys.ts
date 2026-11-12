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

/// In the order they sit on screen. Their names are calendar.views.<view>
/// and calendar.shows.<show> in the dictionary (ADR 0006).
export const CALENDAR_VIEWS: CalendarView[] = ["day", "week", "month"];

export const CALENDAR_SHOWS: CalendarShow[] = ["all", "tasks", "dates"];

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

/// A day key as the instant a formatter reads, to be formatted with
/// `timeZone: "UTC"` (KEY_FORMAT): the key is already an Israel day, so
/// formatting it in any other zone could show the day before. Names of
/// months and weekdays follow the reader's language (ADR 0006).
export function keyDate(key: string): Date {
  return keyToUtc(key);
}

/// Formats for a day key, for useFormatter / getFormatter. "UTC" here is
/// calendar arithmetic, not a time zone: see keyDate.
export const KEY_FORMAT = {
  short: { day: "numeric", month: "numeric", timeZone: "UTC" },
  month: { month: "long", year: "numeric", timeZone: "UTC" },
  day: { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/// The first and last day of the week on screen, for the heading over
/// the grid ("18.10 עד 24.10"; the words around them are the dictionary's).
export function weekBounds(anchor: string): { start: string; end: string } {
  const days = visibleDays("week", anchor);
  return { start: days[0], end: days[6] };
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
