import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/app-domain/clients";
import { getCurrentHourBank } from "@/lib/app-domain/hour-banks";
import { countOpenAlertEvents } from "@/lib/app-domain/alerts";
import { LONG_TIMER_HOURS } from "@/lib/app-domain/reports";
import { AppShell } from "@/components/app/AppShell";

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
    canSeeClients && { href: "/app/clients", label: "לקוחות פעילים", value: counts.clients },
    canSeeCategories && { href: "/app/categories", label: "קטגוריות פעילות", value: counts.categories },
    canSeeUsers && { href: "/app/users", label: "משתמשים", value: counts.users },
  ].filter(Boolean) as { href: string; label: string; value: number | null }[];

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-medium text-navy">שלום, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-navy/60">סקירה כללית של המערכת.</p>
        </div>

        {cards.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="rounded-2xl border border-lineDark bg-white p-6 transition-colors hover:border-gold"
              >
                <p className="text-3xl font-medium text-navy">{card.value}</p>
                <p className="mt-2 text-sm text-navy/60">{card.label}</p>
              </Link>
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
              <Link
                href="/app/reports?type=active_timers"
                className="rounded-2xl border border-lineDark bg-white p-6 transition-colors hover:border-gold"
              >
                <p className="text-3xl font-medium text-navy">{metrics.activeTimersCount}</p>
                <p className="mt-2 text-sm text-navy/60">טיימרים פעילים כרגע</p>
                {metrics.longRunningCount > 0 && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {metrics.longRunningCount} מהם רצים מעל {LONG_TIMER_HOURS} שעות ברצף (חריגה)
                  </p>
                )}
              </Link>
              <div className="rounded-2xl border border-lineDark bg-white p-6">
                <p className="text-3xl font-medium text-navy">{formatMinutes(metrics.todayMinutes)}</p>
                <p className="mt-2 text-sm text-navy/60">שעות דווחו היום (סה"כ, כל הלקוחות)</p>
              </div>
              <div className="rounded-2xl border border-lineDark bg-white p-6">
                <p className="text-3xl font-medium text-navy">{formatMinutes(metrics.monthMinutes)}</p>
                <p className="mt-2 text-sm text-navy/60">שעות דווחו החודש (סה"כ, כל הלקוחות)</p>
              </div>
              <Link
                href="/app/reports?type=hours_by_client"
                className="rounded-2xl border border-lineDark bg-white p-6 transition-colors hover:border-gold"
              >
                <p className="text-3xl font-medium text-navy">
                  {metrics.avgUtilizationPct !== null ? `${metrics.avgUtilizationPct}%` : "-"}
                </p>
                <p className="mt-2 text-sm text-navy/60">ניצול ממוצע בבנקי שעות (לקוחות פעילים)</p>
                {metrics.clientsNearLimitCount > 0 && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {metrics.clientsNearLimitCount} לקוחות מעל 90% ניצול
                  </p>
                )}
              </Link>
              {canSeeAlerts && (
                <Link
                  href="/app/alerts"
                  className="rounded-2xl border border-lineDark bg-white p-6 transition-colors hover:border-gold"
                >
                  <p className="text-3xl font-medium text-navy">{openAlerts}</p>
                  <p className="mt-2 text-sm text-navy/60">התראות פתוחות (לא נפתרו)</p>
                </Link>
              )}
              <Link
                href="/app/reports"
                className="rounded-2xl border border-lineDark bg-white p-6 transition-colors hover:border-gold"
              >
                <p className="text-3xl font-medium text-navy">→</p>
                <p className="mt-2 text-sm text-navy/60">לכל הדוחות הפנימיים</p>
              </Link>
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
    </AppShell>
  );
}
