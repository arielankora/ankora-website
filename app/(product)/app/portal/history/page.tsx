import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalHistory } from "@/lib/app-domain/client-portal";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { RecipientsForm } from "../RecipientsForm";

export const metadata = { robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, { label: string; tone: "green" | "amber" | "gray" }> = {
  OPEN: { label: "פתוח", tone: "green" },
  CLOSED: { label: "סגור", tone: "gray" },
  RECALCULATED: { label: "חושב מחדש", tone: "amber" },
};

const REPORT_TYPE_LABEL: Record<string, string> = {
  MONTHLY_DETAILED: "דוח חודשי מפורט",
  WEEKLY_ACTIVITY: "פעילות שבועית",
  HOURS_BY_CATEGORY: "שעות לפי קטגוריה",
  HOUR_BANK_STATUS: "מצב בנק שעות",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

function formatMinutes(minutes: number) {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

// Spec 13's History: "cycles קודמים ודוחות" - past hour-bank cycles plus
// the ReportRun send history, both scoped to the caller's own client via
// getPortalHistory -> resolvePortalClient.
export default async function PortalHistoryPage() {
  const user = await requireUser();

  let history;
  try {
    history = await getPortalHistory(user);
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

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-medium text-navy">היסטוריה</h1>
          <p className="mt-1 text-sm text-navy/60">מחזורי בנק שעות קודמים ודוחות שנשלחו.</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-navy/70">מחזורים קודמים</h2>
          <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
            <table className="w-full min-w-[560px] text-start text-sm">
              <thead>
                <tr className="border-b border-lineDark text-xs text-navy/50">
                  <th className="px-5 py-3 font-medium">תחילת מחזור</th>
                  <th className="px-5 py-3 font-medium">סוף מחזור</th>
                  <th className="px-5 py-3 font-medium">סטטוס</th>
                  <th className="px-5 py-3 font-medium">ניצול</th>
                </tr>
              </thead>
              <tbody>
                {history.cycles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-navy/50">
                      אין עדיין מחזורים.
                    </td>
                  </tr>
                )}
                {history.cycles.map((c, i) => {
                  const status = STATUS_LABEL[c.status] ?? STATUS_LABEL.OPEN;
                  return (
                    <tr key={i} className="border-b border-lineDark last:border-0">
                      <td className="px-5 py-3 text-navy/70">{formatDate(c.cycleStart)}</td>
                      <td className="px-5 py-3 text-navy/70">{formatDate(c.cycleEnd)}</td>
                      <td className="px-5 py-3">
                        <StatusBadge label={status.label} tone={status.tone} />
                      </td>
                      <td className="px-5 py-3 text-navy/70">
                        {formatMinutes(c.consumedMinutes)} / {formatMinutes(c.totalMinutes)} ({Math.round(c.utilizationPct)}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-navy/70">דוחות שנשלחו</h2>
          <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
            <table className="w-full min-w-[560px] text-start text-sm">
              <thead>
                <tr className="border-b border-lineDark text-xs text-navy/50">
                  <th className="px-5 py-3 font-medium">סוג דוח</th>
                  <th className="px-5 py-3 font-medium">תקופה</th>
                  <th className="px-5 py-3 font-medium">נשלח בתאריך</th>
                </tr>
              </thead>
              <tbody>
                {history.reportRuns.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-navy/50">
                      טרם נשלחו דוחות.
                    </td>
                  </tr>
                )}
                {history.reportRuns.map((r) => (
                  <tr key={r.id} className="border-b border-lineDark last:border-0">
                    <td className="px-5 py-3 text-navy/80">{REPORT_TYPE_LABEL[r.reportType] ?? r.reportType}</td>
                    <td className="px-5 py-3 text-navy/70">
                      {formatDate(r.periodStart)} - {formatDate(r.periodEnd)}
                    </td>
                    <td className="px-5 py-3 text-navy/70">{formatDate(r.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {history.canManageRecipients && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-navy/70">ניהול נמענים לדוחות מתוזמנים</h2>
            <p className="text-sm text-navy/60">
              כמנהל לקוח, ניתן לערוך כאן את רשימת הנמענים לכל דוח מתוזמן. סוג הדוח, התדירות וההפעלה/השבתה נשארים בשליטת Ankora.
            </p>
            <div className="space-y-3">
              {history.schedules.length === 0 && (
                <p className="rounded-xl border border-lineDark bg-white px-5 py-6 text-center text-sm text-navy/50">
                  אין עדיין דוחות מתוזמנים עבור לקוח זה.
                </p>
              )}
              {history.schedules.map((s) => (
                <RecipientsForm key={s.id} scheduleId={s.id} reportType={s.reportType} recipients={s.recipients} />
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
