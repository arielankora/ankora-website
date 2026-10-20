import { requireUser } from "@/lib/app-auth/session";
import { parsePeriodOffset, MAX_MONTH_OFFSET, israelMonthReference } from "@/lib/period-offset";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getMonthlyDetailed } from "@/lib/app-domain/client-portal";
import { getApprovedSummaries } from "@/lib/app-domain/portal-summary";
import { Forbidden } from "@/components/app/Forbidden";
import { ExportMenu } from "@/components/app/ExportMenu";
import { ViewTabs } from "@/components/app/ViewTabs";
import { HOURS_TABS } from "../hours/tabs";


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
// the prototype's "ספקים שתואמו" tile was not reproduced.
//
// Portal phase 3 brings back the other half of that note. "סיכום מנהל
// התיק" was left out because there was no field behind it and the prose
// would have been fabricated; it is here now because it is assembled from
// the month's own rows and signed by a person before the client can read
// it. Above the numbers, because a sentence about what happened is what
// someone opens this screen for - the table is the evidence under it.
// 19.10.2026: the body of the old monthly report screen, now the
// "דוח חודשי" view of /app/portal/hours (see ../hours/page.tsx).
export async function MonthlyView({ searchParams }: { searchParams: { monthOffset?: string } }) {
  const user = await requireUser();

  const monthOffset = parsePeriodOffset(searchParams.monthOffset, MAX_MONTH_OFFSET);
  // Israeli month, mid-month reference: see israelMonthReference.
  const { referenceDate } = israelMonthReference(monthOffset);

  let report;
  let summaries: Awaited<ReturnType<typeof getApprovedSummaries>> = [];
  try {
    [report, summaries] = await Promise.all([getMonthlyDetailed(user, referenceDate), getApprovedSummaries(user)]);
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

  // The summary belongs to a calendar month, and this screen moves by
  // offset - so it is matched on the month rather than taken as "the
  // latest", which would show September's words above August's numbers.
  const shownMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
  }).format(referenceDate);
  const summary = summaries.find(
    (s) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(
        s.periodStart
      ) === shownMonth
  );

  return (
    <div className="space-y-4">
        <ViewTabs label="שעות ודוחות" active="monthly" tabs={HOURS_TABS} />

      {summary && (
        // Only for the month on screen, and only when a person approved
        // it. An unapproved draft does not exist as far as this page is
        // concerned - which is the whole of the spec's first rule about
        // generated text, expressed as a query rather than as a promise.
        <div className="rounded-[20px] border border-gold/28 bg-app-surface-sunken p-6 sm:p-7">
          <p className="text-[13.5px] leading-relaxed text-app-text-primary">{summary.draft}</p>
        </div>
      )}

      <div className="rounded-2xl border border-app-border bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-medium text-app-text-primary">דוח {formatMonthTitle(referenceDate)}</p>
            {report.autoSendLabel && <p className="mt-1.5 text-xs text-app-text-secondary">{report.autoSendLabel}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/app/portal/hours?view=monthly&monthOffset=${monthOffset - 1}`}
              className="rounded-full border border-app-border-strong px-4 py-2 text-sm text-app-text-primary hover:border-app-accent"
            >
              חודש קודם
            </a>
            {monthOffset < 0 && (
              <a
                href={`/app/portal/hours?view=monthly&monthOffset=${monthOffset + 1}`}
                className="rounded-full border border-app-border-strong px-4 py-2 text-sm text-app-text-primary hover:border-app-accent"
              >
                חודש הבא
              </a>
            )}
            <ExportMenu baseHref={`/api/portal/export?monthOffset=${monthOffset}`} primary />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-app-border p-3.5">
            <span className="text-[11.5px] text-app-text-secondary">שעות החודש</span>
            <p className="mt-1.5 font-jbmono text-xl text-app-text-primary">{formatHours(report.totalMinutes)}</p>
          </div>
          <div className="rounded-xl border border-app-border p-3.5">
            <span className="text-[11.5px] text-app-text-secondary">משימות שהושלמו</span>
            <p className="mt-1.5 font-jbmono text-xl text-app-text-primary">{report.tasksCompleted}</p>
          </div>
        </div>
      </div>

      <p className="text-sm text-app-text-secondary">
        {formatDate(report.from)} - {formatDate(new Date(report.to.getTime() - 86_400_000))}
      </p>

      <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead>
            <tr className="border-b border-app-border text-xs text-app-text-tertiary">
              <th className="px-5 py-3 font-medium">תאריך</th>
              <th className="px-5 py-3 font-medium">פעילות</th>
              <th className="px-5 py-3 font-medium">קטגוריה</th>
              {report.showEmployeeNames && <th className="px-5 py-3 font-medium">איש צוות</th>}
              <th className="px-5 py-3 font-medium">דקות לחיוב</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={report.showEmployeeNames ? 5 : 4} className="px-5 py-8 text-center text-app-text-tertiary">
                  אין עדיין דיווחים לחודש זה.
                </td>
              </tr>
            )}
            {report.rows.map((row, i) => (
              <tr key={i} className="border-b border-app-border last:border-0">
                <td className="px-5 py-3 text-app-text-secondary">{row.date}</td>
                <td className="px-5 py-3 text-app-text-primary">{row.activity}</td>
                <td className="px-5 py-3 text-app-text-secondary">{row.category}</td>
                {report.showEmployeeNames && <td className="px-5 py-3 text-app-text-secondary">{row.employee}</td>}
                <td className="px-5 py-3 text-app-text-secondary">{row.billableMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
