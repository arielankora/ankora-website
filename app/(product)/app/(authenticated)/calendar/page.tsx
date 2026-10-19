import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, Inbox } from "lucide-react";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { loadCalendar, OVERDUE_LIMIT, UNDATED_LIMIT } from "@/lib/app-domain/calendar";
import { timed } from "@/lib/slow-log";
import { localDateKey } from "@/lib/timezone";
import {
  CALENDAR_SHOWS,
  CALENDAR_VIEWS,
  calendarHref,
  isDayKey,
  parseDrawer,
  parseShow,
  parseView,
  rangeTitle,
  shiftAnchor,
  type CalendarState,
} from "@/lib/calendar-keys";
import { Forbidden } from "@/components/app/Forbidden";
import { CalendarClientSelect } from "./CalendarClientSelect";
import { CalendarGrid } from "./CalendarGrid";

export const metadata = { robots: { index: false, follow: false } };

// 19.10.2026 (Ariel): the calendar. Open tasks on their due day and
// important dates on each day they occur, by day, week or month.
//
// **Everything the screen shows is in its address.** View, day, content,
// client and "mine" are query keys, so the way back from a task is the
// browser's own back button, a reload changes nothing, and a link pasted
// to a colleague opens the same calendar. The task screen's "חזרה" link
// reads the same query from `from=calendar:...` (see list-query.ts).
//
// Its own route rather than a third view of /app/tasks: it shows
// important dates too, and those are not tasks.
//
// Gated like the two screens it draws from (time_entry.create_self).

export default async function CalendarPage(props: {
  searchParams: Promise<{ view?: string; date?: string; show?: string; clientId?: string; mine?: string; drawer?: string }>;
}) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!can(user.role, "time_entry.create_self")) return <Forbidden />;

  const today = localDateKey(new Date());
  const clients = await listAccessibleClients(user);
  const clientId = clients.some((c) => c.id === searchParams.clientId) ? searchParams.clientId : undefined;

  const state: CalendarState = {
    view: parseView(searchParams.view),
    date: isDayKey(searchParams.date) ? searchParams.date : today,
    show: parseShow(searchParams.show),
    clientId,
    // "שלי" is the default, like the tasks screen. `mine=0` is everyone.
    mine: searchParams.mine !== "0",
    // The drawer belongs to tasks, so it has nothing to show under
    // "מועדים" and stays shut there.
    drawer: parseShow(searchParams.show) === "dates" ? undefined : parseDrawer(searchParams.drawer),
  };

  const data = await timed(
    "screen.calendar.load",
    () => loadCalendar(user, { ...state, today }),
    (r) => (r ? `${r.tasks.length} tasks, ${r.dates.length} dates, ${r.undated.length} undated, ${state.view}` : "(failed)")
  );

  const href = (patch: Partial<CalendarState>) => calendarHref({ ...state, ...patch }, today);
  // The query as it is now, for links the grid hands out: a task or a
  // date opened from here comes back to exactly this.
  const query = href({}).split("?")[1] ?? "";

  const segment = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors ${
      active ? "bg-appNavy text-cream" : "text-appNavy/60 hover:text-appNavy"
    }`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-appNavy">יומן</h1>
        <p className="mt-1 text-sm text-appNavy/60">משימות לפי תאריך יעד ומועדים לפי היום שבו הם חלים. גוררים משימה ליום אחר כדי לשנות לה את היעד.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div data-testid="calendar-view" className="flex rounded-full border border-lineDark bg-white p-[3px]">
          {CALENDAR_VIEWS.map((v) => (
            <Link key={v.view} href={href({ view: v.view })} className={segment(state.view === v.view)} aria-current={state.view === v.view ? "page" : undefined}>
              {v.label}
            </Link>
          ))}
        </div>

        <div data-testid="calendar-show" className="flex rounded-full border border-lineDark bg-white p-[3px]">
          {CALENDAR_SHOWS.map((s) => (
            <Link key={s.show} href={href({ show: s.show })} className={segment(state.show === s.show)} aria-current={state.show === s.show ? "page" : undefined}>
              {s.label}
            </Link>
          ))}
        </div>

        <div data-testid="calendar-mine" className="flex rounded-full border border-lineDark bg-white p-[3px]">
          <Link href={href({ mine: true })} className={segment(state.mine)}>
            שלי
          </Link>
          <Link href={href({ mine: false })} className={segment(!state.mine)}>
            כולם
          </Link>
        </div>

        <CalendarClientSelect clients={clients.map((c) => ({ id: c.id, name: c.name }))} value={clientId ?? ""} hrefs={Object.fromEntries([["", href({ clientId: undefined })], ...clients.map((c) => [c.id, href({ clientId: c.id })])])} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Right is "back" in Hebrew, so the right arrow goes to the past. */}
        <Link href={href({ date: shiftAnchor(state.view, state.date, -1) })} aria-label="הקודם" data-testid="calendar-prev" className="rounded-full border border-lineDark bg-white p-2 text-appNavy/70 hover:text-appNavy">
          <ChevronRight size={16} />
        </Link>
        <Link href={href({ date: today })} className="rounded-full border border-lineDark bg-white px-4 py-1.5 text-[13px] font-medium text-appNavy/70 hover:text-appNavy">
          היום
        </Link>
        <Link href={href({ date: shiftAnchor(state.view, state.date, 1) })} aria-label="הבא" data-testid="calendar-next" className="rounded-full border border-lineDark bg-white p-2 text-appNavy/70 hover:text-appNavy">
          <ChevronLeft size={16} />
        </Link>
        <h2 data-testid="calendar-title" className="text-[15px] font-medium text-appNavy">
          {rangeTitle(state.view, state.date)}
        </h2>

        {/* 20.10.2026: the two lists that used to be a fixed column. A
            button each, with its count, so the grid keeps the width until
            somebody wants them. A second press closes. */}
        {state.show !== "dates" && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Link
              href={href({ drawer: state.drawer === "overdue" ? undefined : "overdue" })}
              data-testid="calendar-overdue-button"
              aria-pressed={state.drawer === "overdue"}
              className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                state.drawer === "overdue" ? "border-appNavy bg-appNavy text-cream" : "border-error/35 bg-white text-error hover:border-error/60"
              }`}
            >
              <Clock size={14} strokeWidth={1.8} />
              באיחור
              <span className="font-jbmono text-[12px]">{data.overdueTotal}{data.overdueTotal > OVERDUE_LIMIT ? "+" : ""}</span>
            </Link>
            <Link
              href={href({ drawer: state.drawer === "undated" ? undefined : "undated" })}
              data-testid="calendar-undated-button"
              aria-pressed={state.drawer === "undated"}
              className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                state.drawer === "undated" ? "border-appNavy bg-appNavy text-cream" : "border-gold bg-white text-appNavy hover:border-gold-dim"
              }`}
            >
              <Inbox size={14} strokeWidth={1.8} />
              בלי תאריך
              <span className="font-jbmono text-[12px]">{data.undatedTotal}{data.undatedTotal > UNDATED_LIMIT ? "+" : ""}</span>
            </Link>
          </div>
        )}
      </div>

      <CalendarGrid
        view={state.view}
        anchor={state.date}
        today={today}
        days={data.days}
        tasks={state.show === "dates" ? [] : uniqueById([...data.tasks, ...data.undated, ...data.overdue])}
        dates={data.dates}
        drawer={state.drawer}
        drawerHrefs={{ undated: href({ drawer: "undated" }), overdue: href({ drawer: "overdue" }), close: href({ drawer: undefined }) }}
        undatedMore={data.undatedTotal > data.undated.length}
        overdueMore={data.overdueTotal > data.overdue.length}
        query={query}
        dayHrefs={Object.fromEntries(data.days.map((d) => [d, href({ view: "day", date: d })]))}
      />
    </div>
  );
}

/// An overdue task due inside the range on screen arrives twice: once on
/// its day and once in the overdue list. The grid and the drawer read one
/// list, so it is one row.
function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}
