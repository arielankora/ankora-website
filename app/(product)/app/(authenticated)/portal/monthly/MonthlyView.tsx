import type { User } from "@prisma/client";
import { getFormatter, getTranslations } from "next-intl/server";
import { TIMEZONE } from "@/lib/timezone";
import { israelMonthReference } from "@/lib/period-offset";
import { getMonthlyDetailed, type PortalAutoSend } from "@/lib/app-domain/client-portal";
import { getApprovedSummaries } from "@/lib/app-domain/portal-summary";
import { ExportMenu } from "@/components/app/ExportMenu";
import { formatDecimalHours } from "@/lib/hours-format";
import { MONTHLY_REPORT_ANCHOR } from "../hours/tabs";

/// Sunday first, as ReportSchedule.dayOfWeek counts them.
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

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
  const t = await getTranslations("portal.monthly");
  const format = await getFormatter();
  // ADR 0006: an Israeli month, named in the reader's language; and when
  // the report goes out by itself, worded here from the schedule rather
  // than taken as the Hebrew autoSendLabel.
  const monthTitle = format.dateTime(referenceDate, { month: "long", year: "numeric", timeZone: TIMEZONE });
  const autoSendText = (autoSend: PortalAutoSend | null): string | null => {
    if (!autoSend) return null;
    if (autoSend.frequency === "WEEKLY") return t("autoSendWeekly", { day: t(`weekdays.${WEEKDAY_KEYS[autoSend.dayOfWeek % 7]}`) });
    return t("autoSendMonthly", { day: String(autoSend.dayOfMonth) });
  };
  const hoursHref = (offset: number) => `/app/portal/hours?monthOffset=${offset}#${MONTHLY_REPORT_ANCHOR}`;

  return (
    <section id={MONTHLY_REPORT_ANCHOR} className="scroll-mt-6 rounded-2xl border border-app-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-app-text-primary">{t("title", { month: monthTitle })}</h2>
          <p className="mt-1.5 text-xs text-app-text-secondary">
            {autoSendText(report.autoSend) ?? t("fullDetail")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={hoursHref(monthOffset - 1)}
            className="rounded-full border border-app-border-strong px-4 py-2 text-sm text-app-text-primary hover:border-app-accent"
          >
            {t("prevMonth")}
          </a>
          {monthOffset < 0 && (
            <a
              href={hoursHref(monthOffset + 1)}
              className="rounded-full border border-app-border-strong px-4 py-2 text-sm text-app-text-primary hover:border-app-accent"
            >
              {t("nextMonth")}
            </a>
          )}
          <ExportMenu baseHref={`/api/portal/export?monthOffset=${monthOffset}`} primary />
        </div>
      </div>

      <p className="mt-4 text-sm text-app-text-secondary">
        {t.rich("monthHours", {
          hours: formatDecimalHours(report.totalMinutes),
          h: (chunks) => (
            <span dir="ltr" className="font-jbmono text-app-text-primary">
              {chunks}
            </span>
          ),
        })}
      </p>

      {summary && (
        <p dir="auto" className="mt-4 rounded-xl border border-gold/28 bg-app-surface-sunken p-4 text-[13.5px] leading-relaxed text-app-text-primary">
          {summary.draft}
        </p>
      )}
    </section>
  );
}
