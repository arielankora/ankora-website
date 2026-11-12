import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
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
  KEY_FORMAT,
  keyDate,
  parseDrawer,
  parseShow,
  parseView,
  shiftAnchor,
  weekBounds,
  type CalendarState,
} from "@/lib/calendar-keys";
import { Forbidden } from "@/components/app/Forbidden";
import { MINE_SCOPES, parseMineScope } from "../tasks/mine-scope";
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

  const t = await getTranslations("calendar");
  const tList = await getTranslations("tasks.list");
  const format = await getFormatter();
  const today = localDateKey(new Date());
  const clients = await listAccessibleClients(user);
  const clientId = clients.some((c) => c.id === searchParams.clientId) ? searchParams.clientId : undefined;

  const state: CalendarState = {
    view: parseView(searchParams.view),
    date: isDayKey(searchParams.date) ? searchParams.date : today,
    show: parseShow(searchParams.show),
    clientId,
    // The tasks screen's four scopes and its URL values. "שלי" is the
    // default, `mine=0` is everyone. See mine-scope.ts.
    mine: parseMineScope(searchParams.mine),
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

  // The heading over the grid: "אוקטובר 2026", "18.10 עד 24.10", or the
  // full day, in the reader's language (ADR 0006).
  const rangeTitle = () => {
    if (state.view === "day") return format.dateTime(keyDate(state.date), KEY_FORMAT.day);
    if (state.view === "month") return format.dateTime(keyDate(state.date), KEY_FORMAT.month);
    const { start, end } = weekBounds(state.date);
    return t("weekRange", { start: format.dateTime(keyDate(start), KEY_FORMAT.short), end: format.dateTime(keyDate(end), KEY_FORMAT.short) });
  };

  const segment = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors ${
      active ? "bg-app-surface-nav text-cream" : "text-app-text-secondary hover:text-app-text-primary"
    }`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
        <p className="mt-1 text-sm text-app-text-secondary">{t("subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div data-testid="calendar-view" className="flex rounded-full border border-app-border bg-white p-[3px]">
          {CALENDAR_VIEWS.map((v) => (
            <Link key={v} href={href({ view: v })} className={segment(state.view === v)} aria-current={state.view === v ? "page" : undefined}>
              {t(`views.${v}`)}
            </Link>
          ))}
        </div>

        <div data-testid="calendar-show" className="flex rounded-full border border-app-border bg-white p-[3px]">
          {CALENDAR_SHOWS.map((s) => (
            <Link key={s} href={href({ show: s })} className={segment(state.show === s)} aria-current={state.show === s ? "page" : undefined}>
              {t(`shows.${s}`)}
            </Link>
          ))}
        </div>

        <div data-testid="calendar-mine" className="flex rounded-full border border-app-border bg-white p-[3px]">
          {MINE_SCOPES.map((scope) => (
            <Link key={scope} href={href({ mine: scope })} className={segment(state.mine === scope)} aria-current={state.mine === scope ? "page" : undefined}>
              {tList(`mine.${scope}`)}
            </Link>
          ))}
        </div>

        <CalendarClientSelect clients={clients.map((c) => ({ id: c.id, name: c.name }))} value={clientId ?? ""} hrefs={Object.fromEntries([["", href({ clientId: undefined })], ...clients.map((c) => [c.id, href({ clientId: c.id })])])} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Right is "back" in Hebrew, so the right arrow goes to the past.
            In a left-to-right page both arrows turn around (ADR 0006). */}
        <Link href={href({ date: shiftAnchor(state.view, state.date, -1) })} aria-label={t("nav.prev")} data-testid="calendar-prev" className="rounded-full border border-app-border bg-white p-2 text-app-text-secondary hover:text-app-text-primary">
          <ChevronRight size={16} className="ltr:rotate-180" />
        </Link>
        <Link href={href({ date: today })} className="rounded-full border border-app-border bg-white px-4 py-1.5 text-[13px] font-medium text-app-text-secondary hover:text-app-text-primary">
          {t("nav.today")}
        </Link>
        <Link href={href({ date: shiftAnchor(state.view, state.date, 1) })} aria-label={t("nav.next")} data-testid="calendar-next" className="rounded-full border border-app-border bg-white p-2 text-app-text-secondary hover:text-app-text-primary">
          <ChevronLeft size={16} className="ltr:rotate-180" />
        </Link>
        <h2 data-testid="calendar-title" className="text-[15px] font-medium text-app-text-primary">
          {rangeTitle()}
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
                state.drawer === "overdue" ? "border-app-surface-nav bg-app-surface-nav text-cream" : "border-app-error/35 bg-white text-app-error hover:border-app-error/60"
              }`}
            >
              <Clock size={14} strokeWidth={1.8} />
              {t("overdue")}
              <span className="font-jbmono text-[12px]">{data.overdueTotal}{data.overdueTotal > OVERDUE_LIMIT ? "+" : ""}</span>
            </Link>
            <Link
              href={href({ drawer: state.drawer === "undated" ? undefined : "undated" })}
              data-testid="calendar-undated-button"
              aria-pressed={state.drawer === "undated"}
              className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                state.drawer === "undated" ? "border-app-surface-nav bg-app-surface-nav text-cream" : "border-gold bg-white text-app-text-primary hover:border-gold-dim"
              }`}
            >
              <Inbox size={14} strokeWidth={1.8} />
              {t("undated")}
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
