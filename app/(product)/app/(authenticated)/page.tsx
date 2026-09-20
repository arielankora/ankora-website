import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Tag, UserCog, Timer, Clock, Wallet, Bell, BarChart3, ArrowLeft, LayoutGrid, type LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/app-auth/session";
import { KpiCard } from "@/components/app/KpiCard";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/app-domain/clients";
import { getCurrentHourBank } from "@/lib/app-domain/hour-banks";
import { countOpenAlertEvents } from "@/lib/app-domain/alerts";
import { LONG_TIMER_HOURS } from "@/lib/app-domain/reports";
import { getHoursTrend } from "@/lib/app-domain/overview-trend";
import { HoursTrendChart } from "@/components/app/HoursTrendChart";
import { listUpcomingImportantDates } from "@/lib/app-domain/important-dates";
import { ProgressBar } from "@/components/app/ProgressBar";
import { ActiveTimersList, type ActiveTimerRow } from "@/components/app/ActiveTimersList";
import { EmptyState } from "@/components/app/states/EmptyState";

export const metadata = { robots: { index: false, follow: false } };

async function loadCounts(canSeeClients: boolean, canSeeCategories: boolean, canSeeUsers: boolean) {
  const [clients, categories, users] = await Promise.all([
    canSeeClients ? prisma.client.count({ where: { deletedAt: null, status: "ACTIVE" } }) : null,
    canSeeCategories ? prisma.category.count({ where: { deletedAt: null, active: true } }) : null,
    canSeeUsers ? prisma.user.count({ where: { deletedAt: null, status: { not: "ARCHIVED" } } }) : null,
  ]);
  return { clients, categories, users };
}

/// Phase 5 (spec 12 Overview row): "KPI cards: active timers, total
/// today/month, client utilization, alerts, overdue anomalies." Gated on
/// report.internal.view - Overview sits in spec 12's admin-screens table
/// alongside Reports/Hour Banks/Alerts, not the employee-facing screens of
/// spec 11, so an ANKORA_EMPLOYEE (who lacks report.internal.view) keeps
/// seeing today's simple empty-state Overview rather than operational
/// metrics about every client/employee that spec 4.1 never grants them
/// visibility into.
async function loadOperationalMetrics() {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
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

  const bankSnapshots = (await Promise.all(activeClients.map((c) => getCurrentHourBank(c.id)))).filter(
    (s): s is NonNullable<typeof s> => s !== null
  );
  const avgUtilizationPct =
    bankSnapshots.length > 0
      ? Math.round(bankSnapshots.reduce((sum, s) => sum + s.utilization.utilizationPct, 0) / bankSnapshots.length)
      : null;
  const clientsNearLimitCount = bankSnapshots.filter((s) => s.utilization.utilizationPct >= 90).length;

  return {
    activeTimersCount,
    longRunningCount,
    todayMinutes: Math.round((todayAgg._sum.actualSeconds ?? 0) / 60),
    monthMinutes: Math.round((monthAgg._sum.actualSeconds ?? 0) / 60),
    avgUtilizationPct,
    clientsNearLimitCount,
  };
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

  const canSeeClients = can(user.role, "client.manage");
  const canSeeCategories = can(user.role, "category.manage");
  const canSeeUsers = can(user.role, "user.manage");
  const canSeeAudit = can(user.role, "audit.view");
  const canSeeReports = can(user.role, "report.internal.view");
  const canSeeAlerts = can(user.role, "alert.manage");

  const canSeeImportantDates = can(user.role, "time_entry.create_self");

  const [counts, metrics, openAlerts, trend, upcomingDates, activeTimerRows] = await Promise.all([
    loadCounts(canSeeClients, canSeeCategories, canSeeUsers),
    canSeeReports ? loadOperationalMetrics() : null,
    canSeeAlerts ? countOpenAlertEvents() : null,
    canSeeReports ? getHoursTrend() : null,
    // Phase 10 ("מועדים חשובים"): dashboard "upcoming dates" card - same
    // gate as the Important Dates nav item/screen itself.
    canSeeImportantDates ? listUpcomingImportantDates(user, 5) : null,
    // App redesign (handoff README, screen 1): live "טיימרים פעילים כרגע"
    // list - same visibility gate as the rest of the operational metrics.
    canSeeReports ? loadActiveTimerRows() : null,
  ]);

  const cards = [
    canSeeClients && { href: "/app/clients", label: "לקוחות פעילים", value: counts.clients, icon: Users },
    canSeeCategories && { href: "/app/categories", label: "קטגוריות פעילות", value: counts.categories, icon: Tag },
    canSeeUsers && { href: "/app/users", label: "משתמשים", value: counts.users, icon: UserCog },
  ].filter(Boolean) as { href: string; label: string; value: number | null; icon: LucideIcon }[];

  // App redesign (handoff README, screen 1): "ריבוע תאריך 42px (אדום כשדחוף)".
  // "Urgent" here is a simple ≤2-day threshold for this small dashboard
  // widget - the full Important Dates screen (its own redesign pass) is
  // where the real multi-tier urgency policy lives.
  const URGENT_WITHIN_DAYS = 2;
  function isUrgentDate(occursAt: Date | null): boolean {
    if (!occursAt) return false;
    return occursAt.getTime() - Date.now() <= URGENT_WITHIN_DAYS * 86_400_000;
  }

  const hasAnyContent = cards.length > 0 || !!metrics;

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-appNavy">שלום, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-appNavy/60">סקירה כללית של המערכת.</p>
        </div>

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
            <KpiCard icon={Clock} label="שעות דווחו היום (כל הלקוחות)" value={formatMinutes(metrics.todayMinutes)} />
            <KpiCard
              href="/app/reports?type=hours_by_client"
              icon={Wallet}
              label="ניצול ממוצע בבנקי שעות"
              value={metrics.avgUtilizationPct !== null ? `${metrics.avgUtilizationPct}%` : "-"}
              footer={
                metrics.avgUtilizationPct !== null && (
                  <div className="mt-2.5">
                    <ProgressBar percent={metrics.avgUtilizationPct} dangerAt={90} />
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

        {cards.length > 0 && (
          <div>
            {metrics && <h2 className="mb-3 text-sm font-medium text-appNavy/70">ספירות</h2>}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
              {cards.map((card) => (
                <KpiCard key={card.href} href={card.href} icon={card.icon} label={card.label} value={card.value} />
              ))}
            </div>
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
