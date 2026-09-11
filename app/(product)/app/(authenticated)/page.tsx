import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Tag, UserCog, Timer, Clock, CalendarClock, Wallet, Bell, BarChart3, ArrowLeft, type LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/app-auth/session";
import { KpiCard } from "@/components/app/KpiCard";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/app-domain/clients";
import { getCurrentHourBank } from "@/lib/app-domain/hour-banks";
import { countOpenAlertEvents } from "@/lib/app-domain/alerts";
import { LONG_TIMER_HOURS } from "@/lib/app-domain/reports";

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

  const [counts, metrics, openAlerts] = await Promise.all([
    loadCounts(canSeeClients, canSeeCategories, canSeeUsers),
    canSeeReports ? loadOperationalMetrics() : null,
    canSeeAlerts ? countOpenAlertEvents() : null,
  ]);

  const cards = [
    canSeeClients && { href: "/app/clients", label: "לקוחות פעילים", value: counts.clients, icon: Users },
    canSeeCategories && { href: "/app/categories", label: "קטגוריות פעילות", value: counts.categories, icon: Tag },
    canSeeUsers && { href: "/app/users", label: "משתמשים", value: counts.users, icon: UserCog },
  ].filter(Boolean) as { href: string; label: string; value: number | null; icon: LucideIcon }[];

  return (
    <>
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-medium text-navy">שלום, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-navy/60">סקירה כללית של המערכת.</p>
        </div>

        {cards.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <KpiCard key={card.href} href={card.href} icon={card.icon} label={card.label} value={card.value} />
            ))}
          </div>
        ) : (
          !metrics && (
            <div className="rounded-2xl border border-lineDark bg-white p-6 text-sm text-navy/60">
              אין עדיין נתונים להצגה עבור התפקיד שלך.
            </div>
          )
        )}

        {metrics && (
          <div>
            <h2 className="text-sm font-medium text-navy/70">KPI תפעוליים</h2>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                href="/app/reports?type=active_timers"
                icon={Timer}
                label="טיימרים פעילים כרגע"
                value={metrics.activeTimersCount}
                footer={
                  metrics.longRunningCount > 0 && (
                    <p className="mt-1 text-xs font-medium text-red-600">
                      {metrics.longRunningCount} מהם רצים מעל {LONG_TIMER_HOURS} שעות ברצף (חריגה)
                    </p>
                  )
                }
              />
              <KpiCard icon={Clock} label="שעות דווחו היום (סה&quot;כ, כל הלקוחות)" value={formatMinutes(metrics.todayMinutes)} />
              <KpiCard
                icon={CalendarClock}
                label="שעות דווחו החודש (סה&quot;כ, כל הלקוחות)"
                value={formatMinutes(metrics.monthMinutes)}
              />
              <KpiCard
                href="/app/reports?type=hours_by_client"
                icon={Wallet}
                label="ניצול ממוצע בבנקי שעות (לקוחות פעילים)"
                value={metrics.avgUtilizationPct !== null ? `${metrics.avgUtilizationPct}%` : "-"}
                footer={
                  metrics.clientsNearLimitCount > 0 && (
                    <p className="mt-1 text-xs font-medium text-red-600">
                      {metrics.clientsNearLimitCount} לקוחות מעל 90% ניצול
                    </p>
                  )
                }
              />
              {canSeeAlerts && (
                <KpiCard href="/app/alerts" icon={Bell} label="התראות פתוחות (לא נפתרו)" value={openAlerts} />
              )}
              <KpiCard
                href="/app/reports"
                icon={BarChart3}
                label="לכל הדוחות הפנימיים"
                value={<ArrowLeft size={24} strokeWidth={1.75} />}
              />
            </div>
          </div>
        )}

        {canSeeAudit && (
          <Link
            href="/app/audit-log"
            className="inline-block text-sm text-gold-dim underline underline-offset-4"
          >
            צפייה ביומן הפעולות
          </Link>
        )}
      </div>
    </>
  );
}
