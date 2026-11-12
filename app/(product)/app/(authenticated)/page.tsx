import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  Timer,
  Clock,
  Wallet,
  Bell,
  BarChart3,
  ArrowLeft,
  LayoutGrid,
  ListChecks,
  TriangleAlert,
  Repeat,
} from "lucide-react";
import { requireUser } from "@/lib/app-auth/session";
import { timed } from "@/lib/slow-log";
import { KpiCard } from "@/components/app/KpiCard";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/app-domain/clients";
import { cycleElapsedShare, getCurrentHourBanksForClients, getPrepaidForecastsForClients } from "@/lib/app-domain/hour-banks";
import { getAlertCoverage, listOpenAlertEvents } from "@/lib/app-domain/alerts";
import { LONG_TIMER_HOURS } from "@/lib/app-domain/reports";
import { getHoursTrend } from "@/lib/app-domain/overview-trend";
import { HoursTrendChart } from "@/components/app/HoursTrendChart";
import { listUpcomingImportantDates } from "@/lib/app-domain/important-dates";
import { ProgressBar } from "@/components/app/ProgressBar";
import { ActiveTimerMiniRows, type ActiveTimerRow } from "@/components/app/ActiveTimersList";
import { EmptyState } from "@/components/app/states/EmptyState";
import { listMyOpenTasks, stalledPromisesByClient, STALE_PROMISE_HOURS } from "@/lib/app-domain/tasks";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";
import { formatClockMinutes } from "@/lib/hours-format";
import { taskHref } from "./tasks/list-query";
import { listMyRoutines } from "@/lib/app-domain/process-checks";
import { Drawer } from "@/components/app/Drawer";
import { ProcessCheckForm } from "./clients/[clientId]/ProcessCheckForm";

export const metadata = { robots: { index: false, follow: false } };

async function loadOperationalMetrics() {
  const now = new Date();
  // Israel's day and month, not the server's. These were
  // `setHours(0, 0, 0, 0)` and `new Date(year, month, 1)`, which on a
  // server running in UTC start "today" at 03:00 Israel time (02:00 in
  // winter): anything logged between midnight and three was counted as
  // yesterday. Found 26.9.2026 while making the card clickable.
  const todayKey = localDateKey(now);
  const startOfToday = localDateTimeToUtc(todayKey, "00:00", TIMEZONE);
  const startOfMonth = localDateTimeToUtc(`${todayKey.slice(0, 8)}01`, "00:00", TIMEZONE);
  const longTimerCutoff = new Date(now.getTime() - LONG_TIMER_HOURS * 3600_000);

  const [activeTimersCount, longRunningCount, todayAgg, monthAgg, activeClients, timersByPerson, todayByClient] = await Promise.all([
    prisma.timeEntry.count({ where: { endAt: null, deletedAt: null } }),
    prisma.timeEntry.count({ where: { endAt: null, deletedAt: null, startAt: { lte: longTimerCutoff } } }),
    prisma.timeEntry.aggregate({
      where: { deletedAt: null, endAt: { not: null }, startAt: { gte: startOfToday } },
      _sum: { actualSeconds: true },
    }),
    prisma.timeEntry.aggregate({
      where: { deletedAt: null, endAt: { not: null }, startAt: { gte: startOfMonth } },
      _sum: { actualSeconds: true },
    }),
    listClients().then((clients) => clients.filter((c) => c.status === "ACTIVE")),
    // Parallel timers (5.10.2026): the count above is timers, not people.
    // Grouped by person so the card can say how many people that is and
    // how many of them are running two at once.
    prisma.timeEntry.groupBy({ by: ["userId"], where: { endAt: null, deletedAt: null }, _count: { _all: true } }),
    // 9.10.2026: the "hours today" card names its two biggest clients.
    // Same filter as todayAgg above, so the rows add up toward the total.
    prisma.timeEntry.groupBy({
      by: ["clientId"],
      where: { deletedAt: null, endAt: { not: null }, startAt: { gte: startOfToday } },
      _sum: { actualSeconds: true },
    }),
  ]);

  // One batched lookup, not one per client.
  //
  // This was `activeClients.map((c) => getCurrentHourBank(c.id))`, which
  // cost six to nine round trips per client - two of them writes - on
  // every render of this page, and on every Server Action that
  // revalidates it. Creating an important date was measured at over
  // ninety seconds because of it. See the note on
  // getCurrentHourBanksForClients, and
  // claude/perf-dashboard-n-plus-one-2026-09.
  const bankSnapshots = [
    ...(await getCurrentHourBanksForClients(activeClients.map((c) => c.id))).values(),
  ];
  // Ariel, 26.9.2026: "כמה שעות מתוך כמה, ומה היה צפוי".
  //
  // Hours rather than an average of percentages. The card used to show
  // the mean of every client's own percentage, which cannot be written as
  // "55 of 100 hours": a client with a 5-hour bank moved it as much as a
  // client with 80. Summing the hours makes the percentage and the hours
  // the same fact, and weights each client by how much is at stake.
  //
  // The pace is each bank's elapsed share of its OWN cycle, weighted the
  // same way. Cycles do not all start on the first of the month, so "we
  // are half way through the month" would be wrong for any bank that
  // renews on the 15th.
  const bankTotalMinutes = bankSnapshots.reduce((sum, s) => sum + Math.max(0, s.utilization.totalMinutes), 0);
  const bankConsumedMinutes = bankSnapshots.reduce((sum, s) => sum + s.utilization.consumedMinutes, 0);
  // A prepaid package (12.10.2026) has no pace to be ahead of or behind:
  // it is bought to be used until it runs out, and its "cycle" is a year
  // of validity. It counts as on pace, expected = used, so it moves the
  // hours but not the verdict. Its own question is when it runs out,
  // answered by packagesEndingSoon below.
  const expectedMinutes = bankSnapshots.reduce(
    (sum, s) =>
      sum +
      (s.bank.kind === "PREPAID"
        ? Math.min(s.utilization.consumedMinutes, Math.max(0, s.utilization.totalMinutes))
        : Math.max(0, s.utilization.totalMinutes) * cycleElapsedShare(s.bank.cycleStart, s.bank.cycleEnd, now)),
    0
  );
  const forecasts = await getPrepaidForecastsForClients(
    bankSnapshots.map((s) => ({ clientId: s.bank.clientId, kind: s.bank.kind, remainingMinutes: s.utilization.remainingMinutes })),
    now
  );
  const packagesEndingSoon = [...forecasts.values()].filter(
    (f) => f.status === "projected" && f.daysLeft <= PACKAGE_ENDING_SOON_DAYS
  ).length;
  const avgUtilizationPct = bankTotalMinutes > 0 ? Math.round((bankConsumedMinutes / bankTotalMinutes) * 100) : null;
  const expectedUtilizationPct = bankTotalMinutes > 0 ? Math.round((expectedMinutes / bankTotalMinutes) * 100) : null;
  const clientsNearLimitCount = bankSnapshots.filter((s) => s.utilization.utilizationPct >= 90).length;

  // Names come from the active-clients list already loaded; a client that
  // was paused today still has a name worth showing, so fall back to a
  // lookup for whatever is missing rather than dropping its hours.
  const todaySorted = (todayByClient as { clientId: string; _sum: { actualSeconds: number | null } }[])
    .map((g) => ({ clientId: g.clientId, minutes: Math.round((g._sum.actualSeconds ?? 0) / 60) }))
    .filter((g) => g.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  const topToday = todaySorted.slice(0, 2);
  const knownNames = new Map(activeClients.map((c) => [c.id, c.name]));
  const unknownIds = topToday.map((t) => t.clientId).filter((id) => !knownNames.has(id));
  if (unknownIds.length > 0) {
    const extra = await prisma.client.findMany({ where: { id: { in: unknownIds } }, select: { id: true, name: true } });
    for (const c of extra) knownNames.set(c.id, c.name);
  }

  return {
    todayTopClients: topToday.map((t) => ({ ...t, name: knownNames.get(t.clientId) ?? "-" })),
    todayClientCount: todaySorted.length,
    activeTimersCount,
    activeTimerPeopleCount: timersByPerson.length,
    parallelTimerPeopleCount: timersByPerson.filter((g: { _count: { _all: number } }) => g._count._all > 1).length,
    longRunningCount,
    todayMinutes: Math.round((todayAgg._sum.actualSeconds ?? 0) / 60),
    monthMinutes: Math.round((monthAgg._sum.actualSeconds ?? 0) / 60),
    avgUtilizationPct,
    expectedUtilizationPct,
    bankTotalMinutes,
    bankConsumedMinutes,
    clientsNearLimitCount,
    packagesEndingSoon,
  };
}

/// A prepaid package projected to run out within this many days is named
/// on the bank card: the time to talk about the next load.
const PACKAGE_ENDING_SOON_DAYS = 14;

/// Whole hours for the card: "55 מתוך 100 שעות". A bank is sold in
/// hours, and minutes on a summary card are precision nobody asked for.
/// Formatted in the reader's locale by the caller (ADR 0006).
function wholeHours(minutes: number): number {
  return Math.round(minutes / 60);
}

function formatMinutes(minutes: number): string {
  return formatClockMinutes(minutes);
}

type ActiveTimerRawRow = {
  id: string;
  startAt: Date;
  user: { name: string };
  client: { name: string };
  category: { name: string };
};

/// App redesign (handoff README, screen 1 "בית"): "טיימרים פעילים כרגע"
/// live list, new in this pass (the KPI row above only ever showed a
/// count). Same report.internal.view gate as loadOperationalMetrics -
/// this is the same "every employee's timers" visibility, just the
/// per-row detail instead of just the count.
async function loadActiveTimerRows(): Promise<ActiveTimerRow[]> {
  const rows: ActiveTimerRawRow[] = await prisma.timeEntry.findMany({
    where: { endAt: null, deletedAt: null },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      startAt: true,
      user: { select: { name: true } },
      client: { select: { name: true } },
      category: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    userName: r.user.name,
    clientName: r.client.name,
    categoryName: r.category.name,
    startAt: r.startAt.toISOString(),
  }));
}

/// A card line, not a rule definition: "הגיע ל-80% מהבנק" reads at a
/// glance where the Alerts screen's "אחוז ניצול: 80 או יותר" describes
/// the rule. Also keeps the word "ניצול" off this card, which the bank
/// card next to it is found by. Said in the reader's language from
/// home.kpi.alerts.type (ADR 0006); an unknown type shows as itself.
const SHORT_ALERT_TYPES = ["UTILIZATION_PCT", "REMAINING_MINUTES", "CONSUMED_MINUTES", "OVERAGE"] as const;
type ShortAlertType = (typeof SHORT_ALERT_TYPES)[number];
function isShortAlertType(type: string): type is ShortAlertType {
  return (SHORT_ALERT_TYPES as readonly string[]).includes(type);
}

/// 9.10.2026: the alerts card says what the number is counting. The two
/// most recent open alerts by name, or, when there are none, how many
/// rules are watching - so a zero reads as "all clear" only when
/// something is actually being watched.
async function loadAlertSummary() {
  const [open, coverage] = await Promise.all([listOpenAlertEvents(), getAlertCoverage()]);
  return {
    count: open.length,
    top: open.slice(0, 2).map((e) => ({
      id: e.id,
      clientName: e.rule.client.name,
      type: e.rule.type as string,
      value: e.rule.thresholdValue,
    })),
    ...coverage,
  };
}

export default async function AppHomePage() {
  const user = await requireUser();

  // Phase 6: this Overview screen is Ankora-internal (spec 12's admin
  // screens table). A CLIENT_USER's home is the Client Portal dashboard
  // instead (spec 13) - AppShell's nav already only ever links a
  // CLIENT_USER to /app/portal/*, but redirecting here too closes the
  // gap for the "Ankora" logo link and anyone who bookmarks /app itself.
  if (user.role === "CLIENT_USER") redirect("/app/portal");

  const t = await getTranslations("home");
  const format = await getFormatter();
  const percent = (pct: number) => format.number(pct / 100, { style: "percent" });
  /// A `YYYY-MM-DD` key as day and month ("5.11" in Hebrew), formatted at
  /// UTC so the calendar day never moves with the reader's time zone.
  const dayMonthOfKey = (dateKey: string) => {
    const [y, m, d] = dateKey.split("-").map(Number);
    return format.dateTime(new Date(Date.UTC(y, m - 1, d)), { day: "numeric", month: "numeric", timeZone: "UTC" });
  };

  const canSeeAudit = can(user.role, "audit.view");
  const canSeeReports = can(user.role, "report.internal.view");
  const canSeeAlerts = can(user.role, "alert.manage");

  const canSeeImportantDates = can(user.role, "time_entry.create_self");

  // Measured. Every write that ends with revalidatePath("/app") ships this
  // screen's re-render back inside its own response, so a slow dashboard
  // is indistinguishable from a slow save at the button that triggered it
  // - which is exactly what the browser suite keeps reporting. See
  // lib/slow-log.ts.
  // Team adoption: "today" is the local day boundary, so a manager
  // reading the stalled-promises number at four in the afternoon is
  // asking what has been untouched since this morning.
  const todayKey = localDateKey(new Date());
  const startOfToday = localDateTimeToUtc(todayKey, "00:00", TIMEZONE);

  const [metrics, alerts, trend, upcomingDates, activeTimerRows, myTasks, stalled, routines] = await timed(
    "screen.dashboard.load",
    () =>
    Promise.all([
    canSeeReports ? loadOperationalMetrics() : null,
    canSeeAlerts ? loadAlertSummary() : null,
    canSeeReports ? getHoursTrend() : null,
    // Phase 10 ("מועדים חשובים"): dashboard "upcoming dates" card - same
    // gate as the Important Dates nav item/screen itself.
    canSeeImportantDates ? listUpcomingImportantDates(user, 5) : null,
    // App redesign (handoff README, screen 1): live "טיימרים פעילים כרגע"
    // list - same visibility gate as the rest of the operational metrics.
    canSeeReports ? loadActiveTimerRows() : null,
    // Team adoption, mechanism two: the work this person is holding. Not
    // gated on a reporting permission - it is their own list, and anyone
    // who can log time can hold a task.
    canSeeImportantDates ? listMyOpenTasks(user, 8) : null,
    // Mechanism four: a manager's number, so the same gate as the rest of
    // the operational metrics.
    canSeeReports ? stalledPromisesByClient(user, startOfToday) : null,
    // Org brain: the ongoing processes this person owns or backs up. Same
    // gate as their tasks: it is their own work.
    canSeeImportantDates ? listMyRoutines(user) : null,
    ])
  );

  const stalledTotal = stalled?.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const stalledOverdue = stalled?.reduce((sum, row) => sum + row.overdue, 0) ?? 0;
  // Tasks phase 5: the promises the CLIENT is sitting on. Deliberately
  // not added to the number above. The two ask for different things -
  // one is work to pick up, the other is a reminder to send - and a
  // single total that mixes them is a total nobody can act on.
  const stalledWaiting = stalled?.reduce((sum, row) => sum + row.waiting, 0) ?? 0;

  // App redesign (handoff README, screen 1): "ריבוע תאריך 42px (אדום כשדחוף)".
  // "Urgent" here is a simple ≤2-day threshold for this small dashboard
  // widget - the full Important Dates screen (its own redesign pass) is
  // where the real multi-tier urgency policy lives.
  const URGENT_WITHIN_DAYS = 2;
  function isUrgentDate(occursAt: Date | null): boolean {
    if (!occursAt) return false;
    return occursAt.getTime() - Date.now() <= URGENT_WITHIN_DAYS * 86_400_000;
  }

  // The counts row (clients, categories, users) was removed on 26.9.2026
  // at Ariel's request: numbers that change once a month, on the screen
  // people open every morning.
  const hasAnyContent = !!metrics || (myTasks?.length ?? 0) > 0 || (routines?.length ?? 0) > 0 || (upcomingDates?.length ?? 0) > 0;

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">
            {t.rich("greeting", {
              name: user.name.split(" ")[0],
              who: (chunks) => <span dir="auto">{chunks}</span>,
            })}
          </h1>
        </div>

        {/* Team adoption, mechanism two: the work this person is holding.

            Above the metrics on purpose. Everything below this is a
            number about the business; this is the only block on the
            screen that answers "what is on me", and a person who opens
            their home screen is asking that first. The spec's whole
            premise is that the portal goes stale unless the update sits
            where someone already is, and this is where they already are.

            The eight rows are a cap, not a list: anyone holding more
            than that needs the Tasks screen, and the link is there. */}
        {myTasks && myTasks.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-app-border bg-white">
            <div className="flex items-center justify-between gap-2.5 border-b border-app-border px-[18px] py-3.5">
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-app-text-primary">
                <ListChecks size={15} strokeWidth={2} className="text-app-text-tertiary" />
                {t("myTasks.title")}
              </span>
              <Link href="/app/tasks?mine=1" className="text-[11.5px] text-app-text-accent hover:underline">
                {t("myTasks.allMine")}
              </Link>
            </div>
            <div className="divide-y divide-app-border">
              {myTasks.map((task) => (
                // Each row opens its own task. It used to open the list,
                // and Ariel had to find the task again (15.10.2026). The
                // way back from the task still leads to "my tasks".
                <Link
                  key={task.id}
                  href={taskHref(task.id, "mine=1")}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-[18px] py-3 transition-colors hover:bg-app-surface-sunken"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    {/* The mark the spec asks for: a promise the client
                        can see that has not moved in a day. It is on the
                        row rather than in a separate list, because the
                        person who can fix it is looking at the row. */}
                    {task.stale && (
                      <span
                        title={t("myTasks.staleHint", { hours: STALE_PROMISE_HOURS })}
                        className="shrink-0 text-app-warning"
                      >
                        <TriangleAlert size={13} strokeWidth={2.25} />
                      </span>
                    )}
                    <span dir="auto" className="truncate text-[13.5px] text-app-text-primary">{task.title}</span>
                  </span>
                  <span className="flex items-center gap-2.5 text-[11.5px] text-app-text-tertiary">
                    <span dir="auto" className="truncate">{task.clientName}</span>
                    {task.dueDate && (
                      <span dir="ltr" className="font-jbmono">
                        {format.dateTime(task.dueDate, { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Org brain (spec 3.8): the routine. An ongoing process opens no
            tasks, so without this it would live only in the client's file,
            where nobody looks on an ordinary morning. Under the tasks: a
            task is a promise with a date, a routine is what keeps the
            promises from being needed. */}
        {routines && routines.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-app-border bg-white">
            <div className="flex items-center gap-2 border-b border-app-border px-[18px] py-3.5 text-[13.5px] font-medium text-app-text-primary">
              <Repeat size={15} strokeWidth={2} className="text-app-text-tertiary" />
              {t("routines.title")}
            </div>
            <ul className="divide-y divide-app-border">
              {routines.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-[18px] py-3">
                  <span className="min-w-0">
                    <Link href={`/app/clients/${r.clientId}?tab=file#processes`} className="text-[13.5px] text-app-text-primary hover:text-app-text-accent">
                      <span className="font-mono text-[11.5px] text-app-text-tertiary">{r.code}</span> <bdi>{r.title}</bdi>
                    </Link>
                    <span className="block text-[11.5px] text-app-text-tertiary">
                      {[
                        r.clientName,
                        r.checkEveryDays &&
                          (r.checkText
                            ? t("routines.checkEveryWithText", { every: t("routines.every", { days: r.checkEveryDays }), text: r.checkText })
                            : t("routines.checkEvery", { every: t("routines.every", { days: r.checkEveryDays }) })),
                        r.asBackup && t("routines.asBackup"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-[11.5px]">
                    {r.state && r.dueKey && (
                      <span className={r.state === "LATER" ? "text-app-text-tertiary" : "font-medium text-app-warning"}>
                        {r.state === "LATER"
                          ? t("routines.nextOn", { date: dayMonthOfKey(r.dueKey) })
                          : r.lastCheckedAt
                            ? t(`routines.state.${r.state}`)
                            : t("routines.notCheckedYet")}
                      </span>
                    )}
                    {r.checkEveryDays && (
                      <Drawer triggerLabel={t("routines.logCheck")} title={t("routines.drawerTitle", { code: r.code, title: r.title })} variant="link">
                        <ProcessCheckForm clientId={r.clientId} processId={r.id} checkText={r.checkText} steps={r.steps} from="home" />
                      </Drawer>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* App redesign (handoff README, screen 1): primary 4-card KPI row -
            active timers (with overage row), hours today, avg bank
            utilization (with progress bar), open alerts. auto-fit/minmax
            per the Responsive spec rule ("כל רשת משתמשת ב-auto-fit/minmax"). */}
        {metrics && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
            <KpiCard
              href="/app/reports?type=active_timers"
              icon={Timer}
              label={t("kpi.activeTimers.label")}
              value={metrics.activeTimersCount}
              footer={
                (metrics.parallelTimerPeopleCount > 0 || metrics.longRunningCount > 0 || metrics.activeTimersCount > 0) && (
                  <>
                    {metrics.parallelTimerPeopleCount > 0 && (
                      <p className="mt-1.5 text-[11.5px] text-app-text-secondary">
                        {t("kpi.activeTimers.people", {
                          people: metrics.activeTimerPeopleCount,
                          parallel: metrics.parallelTimerPeopleCount,
                        })}
                      </p>
                    )}
                    {metrics.longRunningCount > 0 && (
                      <p className="mt-1.5 text-[11.5px] font-medium text-app-error">
                        {t("kpi.activeTimers.longRunning", { count: metrics.longRunningCount, hours: LONG_TIMER_HOURS })}
                      </p>
                    )}
                    {/* Longest running first: loadActiveTimerRows sorts by
                        startAt ascending. */}
                    {activeTimerRows && (
                      <ActiveTimerMiniRows
                        rows={activeTimerRows.slice(0, 2)}
                        total={activeTimerRows.length}
                        longTimerHours={LONG_TIMER_HOURS}
                      />
                    )}
                  </>
                )
              }
            />
            {/* Clickable since 26.9.2026: the number invites "by whom, for
                whom", and the matrix report answers exactly that for one
                day. The date is Israel's, the same day the number counts. */}
            <KpiCard
              href={`/app/reports?type=employee_client_matrix&from=${todayKey}&to=${todayKey}`}
              icon={Clock}
              label={t("kpi.today.label")}
              value={formatMinutes(metrics.todayMinutes)}
              footer={
                metrics.todayTopClients.length > 0 && (
                  <div className="mt-2.5 border-t border-app-border pt-1.5">
                    {metrics.todayTopClients.map((c) => (
                      <div key={c.clientId} className="flex items-center justify-between gap-3 py-1.5">
                        <span dir="auto" className="truncate text-[12.5px] text-app-text-primary">{c.name}</span>
                        <span dir="ltr" className="shrink-0 font-jbmono text-[12.5px] text-app-text-secondary">
                          {formatMinutes(c.minutes)}
                        </span>
                      </div>
                    ))}
                    {metrics.todayClientCount > metrics.todayTopClients.length && (
                      <p className="mt-1 text-[11.5px] text-app-text-accent">
                        {t("kpi.today.more", { count: metrics.todayClientCount - metrics.todayTopClients.length })}{" "}
                        {/* Points the reading direction: turned around left to right (ADR 0006). */}
                        <span aria-hidden="true" className="inline-block ltr:rotate-180">
                          ←
                        </span>
                      </p>
                    )}
                  </div>
                )
              }
            />
            <KpiCard
              href="/app/reports?type=hours_by_client"
              icon={Wallet}
              label={t("kpi.bank.label")}
              value={metrics.avgUtilizationPct !== null ? percent(metrics.avgUtilizationPct) : "-"}
              footer={
                metrics.avgUtilizationPct !== null && (
                  <div className="mt-2.5">
                    <p className="-mt-1.5 mb-2.5 text-[12px] text-app-text-secondary">
                      {t.rich("kpi.bank.hoursOf", {
                        used: format.number(wholeHours(metrics.bankConsumedMinutes)),
                        total: format.number(wholeHours(metrics.bankTotalMinutes)),
                        num: (chunks) => <span className="font-jbmono">{chunks}</span>,
                      })}
                    </p>
                    <ProgressBar
                      percent={metrics.avgUtilizationPct}
                      dangerAt={90}
                      markerAt={metrics.expectedUtilizationPct ?? undefined}
                    />
                    {metrics.expectedUtilizationPct !== null && (
                      <p className="mt-1.5 text-[11.5px] text-app-text-secondary">
                        {t.rich("kpi.bank.expected", {
                          pct: percent(metrics.expectedUtilizationPct),
                          num: (chunks) => <span className="font-jbmono">{chunks}</span>,
                        })}
                        {/* Said in words, not only by colour: ahead of the
                            pace is where a bank runs out before its cycle
                            does. Five points either way is "on pace". */}
                        {" · "}
                        {metrics.avgUtilizationPct > metrics.expectedUtilizationPct + 5
                          ? t("kpi.bank.pace.above")
                          : metrics.avgUtilizationPct < metrics.expectedUtilizationPct - 5
                            ? t("kpi.bank.pace.below")
                            : t("kpi.bank.pace.on")}
                      </p>
                    )}
                    {metrics.packagesEndingSoon > 0 && (
                      <p className="mt-1.5 text-[11.5px] font-medium text-app-warning">
                        {t("kpi.bank.packagesEnding", { count: metrics.packagesEndingSoon, days: PACKAGE_ENDING_SOON_DAYS })}
                      </p>
                    )}
                    {metrics.clientsNearLimitCount > 0 && (
                      <p className="mt-1.5 text-[11.5px] font-medium text-app-error">
                        {t("kpi.bank.nearLimit", { count: metrics.clientsNearLimitCount, pct: percent(90) })}
                      </p>
                    )}
                  </div>
                )
              }
            />
            {canSeeAlerts ? (
              <KpiCard
                href="/app/alerts"
                icon={Bell}
                label={t("kpi.alerts.label")}
                value={alerts?.count ?? 0}
                footer={
                  alerts && (
                    <div className="mt-2.5 border-t border-app-border pt-1.5">
                      {alerts.count > 0 ? (
                        <>
                          {alerts.top.map((a) => (
                            <div key={a.id} className="py-1.5">
                              <p dir="auto" className="truncate text-[12.5px] text-app-text-primary">{a.clientName}</p>
                              <p className="truncate text-[11.5px] text-app-error">
                                {/* String values: the Hebrew never had a thousands separator. */}
                                {isShortAlertType(a.type) ? t(`kpi.alerts.type.${a.type}`, { value: String(a.value) }) : a.type}
                              </p>
                            </div>
                          ))}
                          {alerts.count > alerts.top.length && (
                            <p className="mt-1 text-[11.5px] text-app-text-accent">
                              {t("kpi.alerts.more", { count: alerts.count - alerts.top.length })}{" "}
                              {/* Points the reading direction: turned around left to right (ADR 0006). */}
                              <span aria-hidden="true" className="inline-block ltr:rotate-180">
                                ←
                              </span>
                            </p>
                          )}
                        </>
                      ) : alerts.ruleCount > 0 ? (
                        <p className="py-1.5 text-[12px] text-app-text-secondary">
                          {/* 10.10.2026: not "הכל תקין". An alert someone marked as
                              handled is closed even while the client is still past
                              the threshold (RIMED at 107% on the day this shipped),
                              so zero open alerts is a fact about alerts, not a
                              verdict on the clients. */}
                          {t.rich("kpi.alerts.noneOpen", {
                            rules: alerts.ruleCount,
                            clients: alerts.clientCount,
                            num: (chunks) => <span className="font-jbmono">{chunks}</span>,
                          })}
                        </p>
                      ) : (
                        <p className="py-1.5 text-[12px] font-medium text-app-warning">{t("kpi.alerts.noRules")}</p>
                      )}
                    </div>
                  )
                }
              />
            ) : (
              <KpiCard
                href="/app/reports"
                icon={BarChart3}
                label={t("kpi.reports.label")}
                value={<ArrowLeft size={20} strokeWidth={1.75} className="ltr:rotate-180" />}
              />
            )}
          </div>
        )}

        {/* Team adoption, mechanism four: the manager's number.

            Deliberately a manager's metric and not an employee's
            reminder. A person nudged about their own row learns to
            dismiss the nudge; a team measured on a number talks about
            the number, and this is the number that decides whether the
            client portal shows the truth or a week-old picture of it.

            Named by client, because "eleven promises have not moved" is
            a fact nobody can act on and "four of them are Orbit's" is a
            conversation. Zero is worth rendering too: a manager who only
            ever sees this card when it is bad cannot tell a good day
            from a card that stopped working.

            The overdue number is a subset of the big one, never a second
            total, and it is shown as a sentence rather than as its own
            figure. Two figures at the top of a card is two things to
            read before knowing whether the day is fine, and the whole
            value of this card is that it can be read in one glance. */}
        {stalled && (
          <div className="rounded-2xl border border-app-border bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-sm font-medium text-app-text-secondary">{t("stalled.title")}</h2>
              <span
                className={`font-jbmono text-[22px] font-medium ${stalledTotal > 0 ? "text-app-warning" : "text-app-success"}`}
              >
                {stalledTotal}
              </span>
            </div>
            {stalledTotal === 0 ? (
              <p className="mt-1.5 text-[12.5px] text-app-text-secondary">
                {t("stalled.allMoved")}
                {stalledWaiting > 0 && ` ${t("stalled.allMovedWaiting", { count: stalledWaiting })}`}
              </p>
            ) : (
              <>
                <p className="mt-1.5 text-[12.5px] text-app-text-secondary">
                  {t("stalled.intro")}
                  {stalledOverdue > 0 && (
                    <>
                      {" "}
                      <span className="text-app-warning">
                        {t("stalled.overdue", { count: stalledOverdue })}
                      </span>
                    </>
                  )}
                  {stalledWaiting > 0 && ` ${t("stalled.waitingToo", { count: stalledWaiting })}`}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {stalled.slice(0, 8).map((row) => (
                    <Link
                      key={row.clientId}
                      href={`/app/tasks?clientId=${row.clientId}`}
                      className="rounded-full border border-app-border bg-white px-2.5 py-1 text-[11.5px] text-app-text-secondary transition-colors hover:border-gold"
                    >
                      <bdi>{row.clientName}</bdi> · {row.count}
                      {row.overdue > 0 && (
                        <span className="text-app-warning"> · {t("stalled.chipOverdue", { count: row.overdue })}</span>
                      )}
                      {row.waiting > 0 && (
                        <span className="text-app-text-tertiary"> · {t("stalled.chipWaiting", { count: row.waiting })}</span>
                      )}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* App redesign: 1.5fr/1fr row - trend chart + upcoming dates. */}
        {(trend || (upcomingDates && upcomingDates.length > 0)) && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
            {trend && <HoursTrendChart data={trend} />}

            {upcomingDates && upcomingDates.length > 0 && (
              <div className="flex flex-col rounded-2xl border border-app-border bg-white p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-app-text-secondary">{t("dates.title")}</h2>
                  <Link href="/app/important-dates" className="-my-2 py-2 text-xs text-app-text-accent hover:text-app-text-primary">
                    {t("dates.all")}
                  </Link>
                </div>
                <div className="mt-3 flex-1 divide-y divide-app-border">
                  {upcomingDates.map((d) => {
                    const urgent = isUrgentDate(d.nextOccurrenceAt);
                    return (
                      <Link
                        key={d.id}
                        href={`/app/important-dates/${d.id}`}
                        className="flex items-center gap-3 py-2.5 transition-colors hover:bg-app-surface-page"
                      >
                        <div
                          className={`flex h-[42px] w-[42px] shrink-0 flex-col items-center justify-center rounded-xl text-center leading-none ${
                            urgent ? "bg-app-error-soft text-app-error" : "bg-app-surface-page text-app-text-secondary"
                          }`}
                        >
                          {d.nextOccurrenceAt ? (
                            <>
                              <span className="font-jbmono text-sm font-semibold">
                                {format.dateTime(d.nextOccurrenceAt, { day: "numeric" })}
                              </span>
                              <span className="mt-0.5 text-[9px] uppercase">
                                {format.dateTime(d.nextOccurrenceAt, { month: "short" })}
                              </span>
                            </>
                          ) : (
                            "-"
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p dir="auto" className="truncate text-sm font-medium text-app-text-primary">{d.title}</p>
                          <p dir="auto" className="truncate text-xs text-app-text-tertiary">{d.client.name}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {!hasAnyContent && (
          <EmptyState
            icon={LayoutGrid}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        )}

        {canSeeAudit && (
          <Link href="/app/audit-log" className="inline-block text-sm text-app-text-accent hover:text-app-text-primary">
            {t("auditLog")}
          </Link>
        )}
      </div>
    </>
  );
}
