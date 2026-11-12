import type { User } from "@prisma/client";
import { israelMonthReference } from "@/lib/period-offset";
import { getMonthlyDetailed } from "@/lib/app-domain/client-portal";
import { getApprovedSummaries } from "@/lib/app-domain/portal-summary";
import { ExportMenu } from "@/components/app/ExportMenu";
import { formatDecimalHours } from "@/lib/hours-format";
import { MONTHLY_REPORT_ANCHOR } from "../hours/tabs";

function formatMonthTitle(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
}

function monthKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(date);
}

// Spec 13's Monthly Detailed report.
//
// 11.11.2026 (Hadas's portal review): this was the "דוח חודשי" tab: a
// title, two tiles and the same row-per-entry table as the week by days.
// The tab is gone, and what only it had stays here, at the bottom of
// "שעות": a month to pick, the export of that month (the same file the
// monthly email sends), and the account manager's summary once a person
// approved it. The tasks tile moved to the "משימות" tab, the table to
// "לפי ימים".
//
// The hours page resolves the portal client before rendering this, so a
// refusal is already handled there.
export async function MonthlyReportSection({ user, monthOffset }: { user: User; monthOffset: number }) {
  // Israeli month, mid-month reference: see israelMonthReference.
  const { referenceDate } = israelMonthReference(monthOffset);
  const [report, summaries] = await Promise.all([getMonthlyDetailed(user, referenceDate), getApprovedSummaries(user)]);

  // The summary belongs to a calendar month, and this section moves by
  // offset, so it is matched on the month rather than taken as "the
  // latest", which would show September's words above August's numbers.
  // An unapproved draft never reaches getApprovedSummaries.
  const shownMonth = monthKey(referenceDate);
  const summary = summaries.find((s) => monthKey(s.periodStart) === shownMonth);
  const hoursHref = (offset: number) => `/app/portal/hours?monthOffset=${offset}#${MONTHLY_REPORT_ANCHOR}`;

  return (
    <section id={MONTHLY_REPORT_ANCHOR} className="scroll-mt-6 rounded-2xl border border-app-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-app-text-primary">דוח {formatMonthTitle(referenceDate)}</h2>
          <p className="mt-1.5 text-xs text-app-text-secondary">
            {report.autoSendLabel ?? "פירוט מלא של החודש, להורדה."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={hoursHref(monthOffset - 1)}
            className="rounded-full border border-app-border-strong px-4 py-2 text-sm text-app-text-primary hover:border-app-accent"
          >
            חודש קודם
          </a>
          {monthOffset < 0 && (
            <a
              href={hoursHref(monthOffset + 1)}
              className="rounded-full border border-app-border-strong px-4 py-2 text-sm text-app-text-primary hover:border-app-accent"
            >
              חודש הבא
            </a>
          )}
          <ExportMenu baseHref={`/api/portal/export?monthOffset=${monthOffset}`} primary />
        </div>
      </div>

      <p className="mt-4 text-sm text-app-text-secondary">
        שעות החודש:{" "}
        <span dir="ltr" className="font-jbmono text-app-text-primary">
          {formatDecimalHours(report.totalMinutes)}
        </span>
      </p>

      {summary && (
        <p className="mt-4 rounded-xl border border-gold/28 bg-app-surface-sunken p-4 text-[13.5px] leading-relaxed text-app-text-primary">
          {summary.draft}
        </p>
      )}
    </section>
  );
}
