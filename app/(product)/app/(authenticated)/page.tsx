import Link from "next/link";
import { redirect } from "next/navigation";
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
} from "lucide-react";
import { requireUser } from "@/lib/app-auth/session";
import { timed } from "@/lib/slow-log";
import { KpiCard } from "@/components/app/KpiCard";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/app-domain/clients";
import { cycleElapsedShare, getCurrentHourBanksForClients } from "@/lib/app-domain/hour-banks";
import { countOpenAlertEvents } from "@/lib/app-domain/alerts";
import { LONG_TIMER_HOURS } from "@/lib/app-domain/reports";
import { getHoursTrend } from "@/lib/app-domain/overview-trend";
import { HoursTrendChart } from "@/components/app/HoursTrendChart";
import { listUpcomingImportantDates } from "@/lib/app-domain/important-dates";
import { ProgressBar } from "@/components/app/ProgressBar";
import { ActiveTimersList, type ActiveTimerRow } from "@/components/app/ActiveTimersList";
import { EmptyState } from "@/components/app/states/EmptyState";
import { listMyOpenTasks, stalledPromisesByClient, STALE_PROMISE_HOURS } from "@/lib/app-domain/tasks";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";

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

  const [activeTimersCount, longRunningCount, todayAgg, monthAgg, activeClients] = await Promise.all([
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
  const expectedMinutes = bankSnapshots.reduce(
    (sum, s) => sum + Math.max(0, s.utilization.totalMinutes) * cycleElapsedShare(s.bank.cycleStart, s.bank.cycleEnd, now),
    0
  );
  const avgUtilizationPct = bankTotalMinutes > 0 ? Math.round((bankConsumedMinutes / bankTotalMinutes) * 100) : null;
  const expectedUtilizationPct = bankTotalMinutes > 0 ? Math.round((expectedMinutes / bankTotalMinutes) * 100) : null;
  const clientsNearLimitCount = bankSnapshots.filter((s) => s.utilization.utilizationPct >= 90).length;

  return {
    activeTimersCount,
    longRunningCount,
    todayMinutes: Math.round((todayAgg._sum.actualSeconds ?? 0) / 60),
    monthMinutes: Math.round((monthAgg._sum.actualSeconds ?? 0) / 60),
    avgUtilizationPct,
    expectedUtilizationPct,
    bankTotalMinutes,
    bankConsumedMinutes,
    clientsNearLimitCount,
  };
}

/// Whole hours for the card: "55 מתוך 100 שעות". A bank is sold in
/// hours, and minutes on a summary card are precision nobody asked for.
function wholeHours(minutes: number): string {
  return Math.round(minutes / 60).toLocaleString("he-IL");
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
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

export default async function AppHomePage() {
  const user = await requireUser();

  // Phase 6: this Overview screen is Ankora-internal (spec 12's admin
  // screens table). A CLIENT_USER's home is the Client Portal dashboard
  // instead (spec 13) - AppShell's nav already only ever links a
  // CLIENT_USER to /app/portal/*, but redirecting here too closes the
  // gap for the "Ankora" logo link and anyone who bookmarks /app itself.
  if (user.role === "CLIENT_USER") redirect("/app/portal");

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

  const [metrics, openAlerts, trend, upcomingDates, activeTimerRows, myTasks, stalled] = await timed(
    "screen.dashboard.load",
    () =>
    Promise.all([
    canSeeReports ? loadOperationalMetrics() : null,
    canSeeAlerts ? countOpenAlertEvents() : null,
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
  const hasAnyContent = !!metrics || (myTasks?.length ?? 0) > 0 || (upcomingDates?.length ?? 0) > 0;

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-appNavy">שלום, {user.name.split(" ")[0]}</h1>
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
          <div className="overflow-hidden rounded-2xl border border-lineDark bg-white">
            <div className="flex items-center justify-between gap-2.5 border-b border-lineDark px-[18px] py-3.5">
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-appNavy">
                <ListChecks size={15} strokeWidth={2} className="text-appNavy/45" />
                המשימות שלי
              </span>
              <Link href="/app/tasks?mine=1" className="text-[11.5px] text-gold-dim hover:underline">
                לכל המשימות שלי
              </Link>
            </div>
            <div className="divide-y divide-lineDark/60">
              {myTasks.map((t) => (
                <Link
                  key={t.id}
                  href="/app/tasks?mine=1"
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-[18px] py-3 transition-colors hover:bg-appNavy/[0.02]"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    {/* The mark the spec asks for: a promise the client
                        can see that has not moved in a day. It is on the
                        row rather than in a separate list, because the
                        person who can fix it is looking at the row. */}
                    {t.stale && (
                      <span
                        title={`לא זזה מעל ${STALE_PROMISE_HOURS} שעות, והלקוח רואה אותה`}
                        className="shrink-0 text-warning"
                      >
                        <TriangleAlert size={13} strokeWidth={2.25} />
                      </span>
                    )}
                    <span className="truncate text-[13.5px] text-appNavy">{t.title}</span>
                  </span>
                  <span className="flex items-center gap-2.5 text-[11.5px] text-appNavy/50">
                    <span className="truncate">{t.clientName}</span>
                    {t.dueDate && (
                      <span dir="ltr" className="font-jbmono">
                        {new Intl.DateTimeFormat("he-IL", {
                          day: "numeric",
                          month: "short",
                          timeZone: TIMEZONE,
                        }).format(t.dueDate)}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
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
              label="טיימרים פעילים כרגע"
              value={metrics.activeTimersCount}
              footer={
                metrics.longRunningCount > 0 && (
                  <p className="mt-1.5 text-[11.5px] font-medium text-error">
                    {metrics.longRunningCount} מהם רצים מעל {LONG_TIMER_HOURS} שעות ברצף (חריגה)
                  </p>
                )
              }
            />
            {/* Clickable since 26.9.2026: the number invites "by whom, for
                whom", and the matrix report answers exactly that for one
                day. The date is Israel's, the same day the number counts. */}
            <KpiCard
              href={`/app/reports?type=employee_client_matrix&from=${todayKey}&to=${todayKey}`}
              icon={Clock}
              label="שעות דווחו היום (כל הלקוחות)"
              value={formatMinutes(metrics.todayMinutes)}
            />
            <KpiCard
              href="/app/reports?type=hours_by_client"
              icon={Wallet}
              label="ניצול ממוצע בבנקי שעות"
              value={metrics.avgUtilizationPct !== null ? `${metrics.avgUtilizationPct}%` : "-"}
              footer={
                metrics.avgUtilizationPct !== null && (
                  <div className="mt-2.5">
                    <p className="-mt-1.5 mb-2.5 text-[12px] text-appNavy/60">
                      <span className="font-jbmono">{wholeHours(metrics.bankConsumedMinutes)}</span> מתוך{" "}
                      <span className="font-jbmono">{wholeHours(metrics.bankTotalMinutes)}</span> שעות
                    </p>
                    <ProgressBar
                      percent={metrics.avgUtilizationPct}
                      dangerAt={90}
                      markerAt={metrics.expectedUtilizationPct ?? undefined}
                    />
                    {metrics.expectedUtilizationPct !== null && (
                      <p className="mt-1.5 text-[11.5px] text-appNavy/55">
                        צפי להיום: <span className="font-jbmono">{metrics.expectedUtilizationPct}%</span>
                        {/* Said in words, not only by colour: ahead of the
                            pace is where a bank runs out before its cycle
                            does. Five points either way is "on pace". */}
                        {metrics.avgUtilizationPct > metrics.expectedUtilizationPct + 5
                          ? " · מעל הקצב"
                          : metrics.avgUtilizationPct < metrics.expectedUtilizationPct - 5
                            ? " · מתחת לקצב"
                            : " · בקצב"}
                      </p>
                    )}
                    {metrics.clientsNearLimitCount > 0 && (
                      <p className="mt-1.5 text-[11.5px] font-medium text-error">
                        {metrics.clientsNearLimitCount} לקוחות מעל 90% ניצול
                      </p>
                    )}
                  </div>
                )
              }
            />
            {canSeeAlerts ? (
              <KpiCard href="/app/alerts" icon={Bell} label="התראות פתוחות" value={openAlerts} />
            ) : (
              <KpiCard
                href="/app/reports"
                icon={BarChart3}
                label="לכל הדוחות הפנימיים"
                value={<ArrowLeft size={20} strokeWidth={1.75} />}
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
          <div className="rounded-2xl border border-lineDark bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-sm font-medium text-appNavy/70">הבטחות שלא זזו היום</h2>
              <span
                className={`font-jbmono text-[22px] font-medium ${stalledTotal > 0 ? "text-warning" : "text-success"}`}
              >
                {stalledTotal}
              </span>
            </div>
            {stalledTotal === 0 ? (
              <p className="mt-1.5 text-[12.5px] text-appNavy/55">
                כל ההבטחות שהלקוחות רואים זזו היום. זה מה שהפורטל אמור להראות.
                {stalledWaiting > 0 && ` ${stalledWaiting} ממתינות ללקוחות עצמם.`}
              </p>
            ) : (
              <>
                <p className="mt-1.5 text-[12.5px] text-appNavy/55">
                  הלקוחות האלה רואים אצלם משימה פתוחה שלא נגענו בה היום.
                  {stalledOverdue > 0 && (
                    <>
                      {" "}
                      <span className="text-warning">
                        {stalledOverdue} מהן כבר עברו את תאריך היעד.
                      </span>
                    </>
                  )}
                  {stalledWaiting > 0 && ` ועוד ${stalledWaiting} ממתינות ללקוחות עצמם, ולא לנו.`}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {stalled.slice(0, 8).map((row) => (
                    <Link
                      key={row.clientId}
                      href={`/app/tasks?clientId=${row.clientId}`}
                      className="rounded-full border border-lineDark bg-white px-2.5 py-1 text-[11.5px] text-appNavy/70 transition-colors hover:border-gold"
                    >
                      {row.clientName} · {row.count}
                      {row.overdue > 0 && <span className="text-warning"> · {row.overdue} באיחור</span>}
                      {row.waiting > 0 && <span className="text-appNavy/45"> · {row.waiting} ממתינות להם</span>}
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
              <div className="flex flex-col rounded-2xl border border-lineDark bg-white p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-appNavy/70">מועדים חשובים קרובים</h2>
                  <Link href="/app/important-dates" className="text-xs text-gold-dim hover:text-appNavy">
                    לכל המועדים
                  </Link>
                </div>
                <div className="mt-3 flex-1 divide-y divide-lineDark/70">
                  {upcomingDates.map((d) => {
                    const urgent = isUrgentDate(d.nextOccurrenceAt);
                    return (
                      <Link
                        key={d.id}
                        href={`/app/important-dates/${d.id}`}
                        className="flex items-center gap-3 py-2.5 transition-colors hover:bg-cream"
                      >
                        <div
                          className={`flex h-[42px] w-[42px] shrink-0 flex-col items-center justify-center rounded-xl text-center leading-none ${
                            urgent ? "bg-error-soft text-error" : "bg-cream text-appNavy/70"
                          }`}
                        >
                          {d.nextOccurrenceAt ? (
                            <>
                              <span className="font-jbmono text-sm font-semibold">{d.nextOccurrenceAt.getDate()}</span>
                              <span className="mt-0.5 text-[9px] uppercase">
                                {new Intl.DateTimeFormat("he-IL", { month: "short", timeZone: "Asia/Jerusalem" }).format(
                                  d.nextOccurrenceAt
                                )}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-appNavy">{d.title}</p>
                          <p className="truncate text-xs text-appNavy/50">{d.client.name}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* App redesign: live "טיימרים פעילים כרגע" list. */}
        {activeTimerRows && activeTimerRows.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-medium text-appNavy/70">טיימרים פעילים כרגע</h2>
            <ActiveTimersList rows={activeTimerRows} longTimerHours={LONG_TIMER_HOURS} />
          </div>
        )}

        {!hasAnyContent && (
          <EmptyState
            icon={LayoutGrid}
            title="אין עדיין נתונים להצגה"
            description="בהתאם לתפקיד שלך, אין כרגע מדדים או ספירות להציג כאן."
          />
        )}

        {canSeeAudit && (
          <Link href="/app/audit-log" className="inline-block text-sm text-gold-dim hover:text-appNavy">
            צפייה ביומן הפעולות
          </Link>
        )}
      </div>
    </>
  );
}
