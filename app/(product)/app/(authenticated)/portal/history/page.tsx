import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalHistory } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { RecipientsForm } from "../RecipientsForm";
import { PortalTabs } from "../PortalTabs";
import { israelMonthOffset } from "@/lib/period-offset";
import { bankFigures, packageFigures } from "@/lib/hours-format";

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


// App redesign (handoff README, screen 16 "היסטוריה"): the prototype
// shows one merged table with a "הורדה" link per row. The real domain
// already keeps two honestly-different things separate - hour-bank
// cycles (which may not align to calendar months) and actually-sent
// ReportRun rows - so that separation is kept (it's more correct, not
// less), and a download link is added only for a MONTHLY_DETAILED run,
// computed as the same monthOffset the monthly tab/export route already
// accept. Other report types (weekly activity, etc.) have no export route
// today, so no link is fabricated for those rows.
// In Israeli months: a period starts at Israeli midnight on the 1st, which
// is the previous day in UTC. See israelMonthOffset.
function monthOffsetFor(periodStart: Date): number {
  return israelMonthOffset(periodStart);
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
        <>
          <Forbidden />
        </>
      );
    }
    throw err;
  }

  return (
    <>
      <div className="space-y-8">
        <PortalTabs active="history" />

        <div>
          <h1 className="text-xl font-medium text-app-text-primary">היסטוריה</h1>
          <p className="mt-1 text-sm text-app-text-secondary">מחזורים וחבילות שעות קודמים, ודוחות שנשלחו.</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-app-text-secondary">מחזורים וחבילות</h2>
          <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
            <table className="w-full min-w-[560px] text-start text-sm">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-tertiary">
                  <th className="px-5 py-3 font-medium">התחלה</th>
                  <th className="px-5 py-3 font-medium">סיום</th>
                  <th className="px-5 py-3 font-medium">סטטוס</th>
                  <th className="px-5 py-3 font-medium">ניצול</th>
                </tr>
              </thead>
              <tbody>
                {history.cycles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-app-text-tertiary">
                      אין עדיין מחזורים או חבילות.
                    </td>
                  </tr>
                )}
                {history.cycles.map((c, i) => {
                  const status = STATUS_LABEL[c.status] ?? STATUS_LABEL.OPEN;
                  // A package reads as its size and how much of it went,
                  // like the hours screen (12.10.2026).
                  const f =
                    c.kind === "PREPAID"
                      ? packageFigures(c.purchasedMinutes, c.remainingMinutes)
                      : bankFigures(c.totalMinutes, c.consumedMinutes);
                  return (
                    <tr key={i} className="border-b border-app-border last:border-0">
                      <td className="px-5 py-3 text-app-text-secondary">
                        <span className="block text-[11px] text-app-text-tertiary">{c.kind === "PREPAID" ? "חבילה" : "מחזור"}</span>
                        {formatDate(c.cycleStart)}
                      </td>
                      <td className="px-5 py-3 text-app-text-secondary">{formatDate(c.cycleEnd)}</td>
                      <td className="px-5 py-3">
                        <StatusBadge label={status.label} tone={status.tone} />
                      </td>
                      <td className="px-5 py-3 text-app-text-secondary">
                        <bdi dir="ltr">
                          {f.consumed} / {f.total}
                        </bdi>{" "}
                        ({Math.round(c.utilizationPct)}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-app-text-secondary">דוחות שנשלחו</h2>
          <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
            <table className="w-full min-w-[560px] text-start text-sm">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-tertiary">
                  <th className="px-5 py-3 font-medium">סוג דוח</th>
                  <th className="px-5 py-3 font-medium">תקופה</th>
                  <th className="px-5 py-3 font-medium">נשלח בתאריך</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {history.reportRuns.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-app-text-tertiary">
                      טרם נשלחו דוחות.
                    </td>
                  </tr>
                )}
                {history.reportRuns.map((r) => (
                  <tr key={r.id} className="border-b border-app-border last:border-0">
                    <td className="px-5 py-3 text-app-text-primary">{REPORT_TYPE_LABEL[r.reportType] ?? r.reportType}</td>
                    <td className="px-5 py-3 text-app-text-secondary">
                      {formatDate(r.periodStart)} - {formatDate(r.periodEnd)}
                    </td>
                    <td className="px-5 py-3 text-app-text-secondary">{formatDate(r.sentAt)}</td>
                    <td className="px-5 py-3 text-end">
                      {r.reportType === "MONTHLY_DETAILED" && (
                        <a
                          href={`/api/portal/export?monthOffset=${monthOffsetFor(r.periodStart)}&format=pdf`}
                          className="text-xs text-app-text-accent hover:underline"
                        >
                          הורדה
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {history.canManageRecipients && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-app-text-secondary">ניהול נמענים לדוחות מתוזמנים</h2>
            <p className="text-sm text-app-text-secondary">
              כמנהל לקוח, ניתן לערוך כאן את רשימת הנמענים לכל דוח מתוזמן. סוג הדוח, התדירות וההפעלה/השבתה נשארים בשליטת Ankora.
            </p>
            <div className="space-y-3">
              {history.schedules.length === 0 && (
                <p className="rounded-xl border border-app-border bg-white px-5 py-6 text-center text-sm text-app-text-tertiary">
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
    </>
  );
}
