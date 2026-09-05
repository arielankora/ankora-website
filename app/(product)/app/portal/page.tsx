import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalDashboard, getCategorySummary } from "@/lib/app-domain/client-portal";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";

export const metadata = { robots: { index: false, follow: false } };

function formatMinutes(minutes: number) {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

// Spec 13's Client Portal Dashboard + Category Summary, combined on one
// screen (both are compact "at a glance" views - a separate route for
// each would be two nearly-empty pages). Spec 13: "Dashboard: בנק שעות
// נוכחי, נוצל, נותר, % ניצול, ימים עד סוף cycle" + "Category summary:
// hours + % of total." Isolation is structural, not a query filter here:
// getPortalDashboard/getCategorySummary derive the client from the
// caller's own ClientUser membership (lib/app-domain/client-portal.ts's
// resolvePortalClient) - there is no clientId parameter this page could
// even pass incorrectly.
export default async function PortalDashboardPage() {
  const user = await requireUser();

  let dashboard;
  let categorySummary;
  try {
    [dashboard, categorySummary] = await Promise.all([getPortalDashboard(user), getCategorySummary(user)]);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return (
        <AppShell user={user}>
          <Forbidden />
        </AppShell>
      );
    }
    throw err;
  }

  const { client, snapshot, daysUntilCycleEnd } = dashboard;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">שלום, {client.name}</h1>
          <p className="mt-1 text-sm text-navy/60">סקירת בנק השעות שלכם אצל Ankora.</p>
        </div>

        {!snapshot && (
          <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/50">
            טרם הוגדר מחזור בנק שעות. פנו למנהל התיק שלכם ב-Ankora.
          </div>
        )}

        {snapshot && (
          <div className="rounded-2xl border border-lineDark bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-navy">
                מחזור נוכחי: {formatDate(snapshot.bank.cycleStart)} - {formatDate(snapshot.bank.cycleEnd)}
              </h2>
              {daysUntilCycleEnd !== null && (
                <span className="text-xs text-navy/50">{daysUntilCycleEnd} ימים עד סוף המחזור</span>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-navy/40">סה&quot;כ בבנק</p>
                <p className="mt-1 text-lg font-medium text-navy">{formatMinutes(snapshot.utilization.totalMinutes)}</p>
              </div>
              <div>
                <p className="text-xs text-navy/40">נוצל</p>
                <p className="mt-1 text-lg font-medium text-navy">{formatMinutes(snapshot.utilization.consumedMinutes)}</p>
              </div>
              <div>
                <p className="text-xs text-navy/40">נותר</p>
                <p
                  className={`mt-1 text-lg font-medium ${snapshot.utilization.remainingMinutes < 0 ? "text-red-600" : "text-navy"}`}
                >
                  {formatMinutes(snapshot.utilization.remainingMinutes)}
                </p>
              </div>
              <div>
                <p className="text-xs text-navy/40">אחוז ניצול</p>
                <p
                  className={`mt-1 text-lg font-medium ${snapshot.utilization.utilizationPct > 100 ? "text-red-600" : "text-navy"}`}
                >
                  {snapshot.utilization.utilizationPct}%
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-navy">פילוח לפי קטגוריה - החודש</h2>
          {categorySummary.rows.length === 0 ? (
            <p className="mt-3 text-sm text-navy/50">אין עדיין נתונים לחודש הנוכחי.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {categorySummary.rows.map((row) => (
                <div key={row.category} className="flex items-center justify-between text-sm">
                  <span className="text-navy/80">{row.category}</span>
                  <span className="text-navy/60">
                    {formatMinutes(row.minutes)} ({row.pctOfTotal}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
