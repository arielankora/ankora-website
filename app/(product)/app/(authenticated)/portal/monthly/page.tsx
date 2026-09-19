import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getMonthlyDetailed } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { ExportMenu } from "@/components/app/ExportMenu";
import { PortalTabs } from "../PortalTabs";

export const metadata = { robots: { index: false, follow: false } };

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatMonthTitle(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
}

// Spec 13's Monthly Detailed report / spec 14.1's row-per-entry table.
// App redesign (handoff README, screen 16 "דוח חודשי"): title + auto-send
// note + KPI tiles, same as before but restyled - see
// lib/app-domain/client-portal.ts's getMonthlyDetailed comment for why
// the prototype's "ספקים שתואמו" tile and "סיכום מנהל התיק" prose aren't
// reproduced (no backing schema field for either - would be fabricated,
// not real).
export default async function PortalMonthlyPage(props: { searchParams: Promise<{ monthOffset?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

  const monthOffset = Number(searchParams.monthOffset || 0);
  const referenceDate = new Date();
  referenceDate.setUTCMonth(referenceDate.getUTCMonth() + monthOffset);

  let report;
  try {
    report = await getMonthlyDetailed(user, referenceDate);
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
    <div className="space-y-4">
      <PortalTabs active="month" />

      <div className="rounded-2xl border border-lineDark bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-medium text-navy">דוח {formatMonthTitle(referenceDate)}</p>
            {report.autoSendLabel && <p className="mt-1.5 text-xs text-navy/60">{report.autoSendLabel}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/app/portal/monthly?monthOffset=${monthOffset - 1}`}
              className="rounded-full border border-lineDark px-4 py-2 text-sm text-navy/70 hover:border-gold"
            >
              חודש קודם
            </a>
            {monthOffset < 0 && (
              <a
                href={`/app/portal/monthly?monthOffset=${monthOffset + 1}`}
                className="rounded-full border border-lineDark px-4 py-2 text-sm text-navy/70 hover:border-gold"
              >
                חודש הבא
              </a>
            )}
            <ExportMenu baseHref={`/api/portal/export?monthOffset=${monthOffset}`} primary />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-lineDark p-3.5">
            <span className="text-[11.5px] text-navy/55">שעות החודש</span>
            <p className="mt-1.5 font-jbmono text-xl text-navy">{formatHours(report.totalMinutes)}</p>
          </div>
          <div className="rounded-xl border border-lineDark p-3.5">
            <span className="text-[11.5px] text-navy/55">משימות שהושלמו</span>
            <p className="mt-1.5 font-jbmono text-xl text-navy">{report.tasksCompleted}</p>
          </div>
        </div>
      </div>

      <p className="text-sm text-navy/60">
        {formatDate(report.from)} - {formatDate(new Date(report.to.getTime() - 86_400_000))}
      </p>

      <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead>
            <tr className="border-b border-lineDark text-xs text-navy/50">
              <th className="px-5 py-3 font-medium">תאריך</th>
              <th className="px-5 py-3 font-medium">פעילות</th>
              <th className="px-5 py-3 font-medium">קטגוריה</th>
              {report.showEmployeeNames && <th className="px-5 py-3 font-medium">עובד</th>}
              <th className="px-5 py-3 font-medium">דקות לחיוב</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={report.showEmployeeNames ? 5 : 4} className="px-5 py-8 text-center text-navy/50">
                  אין עדיין דיווחים לחודש זה.
                </td>
              </tr>
            )}
            {report.rows.map((row, i) => (
              <tr key={i} className="border-b border-lineDark last:border-0">
                <td className="px-5 py-3 text-navy/70">{row.date}</td>
                <td className="px-5 py-3 text-navy/80">{row.activity}</td>
                <td className="px-5 py-3 text-navy/70">{row.category}</td>
                {report.showEmployeeNames && <td className="px-5 py-3 text-navy/70">{row.employee}</td>}
                <td className="px-5 py-3 text-navy/70">{row.billableMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
