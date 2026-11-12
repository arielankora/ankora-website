import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { TIMEZONE } from "@/lib/timezone";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalHistory } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { RecipientsForm } from "../RecipientsForm";
import { israelMonthOffset } from "@/lib/period-offset";
import { bankFigures, packageFigures } from "@/lib/hours-format";

export const metadata = { robots: { index: false, follow: false } };

// ADR 0006: the labels are in the dictionary (portal.history.status and
// portal.recipients.reportTypes); these say only which exist.
const STATUS_TONE = { OPEN: "green", CLOSED: "gray", RECALCULATED: "amber" } as const;
type CycleStatus = keyof typeof STATUS_TONE;

const REPORT_TYPES = ["MONTHLY_DETAILED", "WEEKLY_ACTIVITY", "HOURS_BY_CATEGORY", "HOUR_BANK_STATUS"] as const;
type ReportType = (typeof REPORT_TYPES)[number];
const isReportType = (value: string): value is ReportType => (REPORT_TYPES as readonly string[]).includes(value);


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

  const t = await getTranslations("portal.history");
  const tReports = await getTranslations("portal.recipients.reportTypes");
  const format = await getFormatter();
  // Cycles and report periods are Israeli days, written in Israel time; when
  // a report was sent is an instant, written in the reader's own time zone.
  const formatDate = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: TIMEZONE });
  const formatInstant = (date: Date) => format.dateTime(date, { dateStyle: "medium" });
  const reportLabel = (type: string) => (isReportType(type) ? tReports(type) : type);

  return (
    <>
      <div className="space-y-8">

        <div>
          <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
          <p className="mt-1 text-sm text-app-text-secondary">{t("subtitle")}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-app-text-secondary">{t("cyclesTitle")}</h2>
          <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
            <table className="w-full min-w-[560px] text-start text-sm">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-tertiary">
                  <th className="px-5 py-3 font-medium">{t("columns.start")}</th>
                  <th className="px-5 py-3 font-medium">{t("columns.end")}</th>
                  <th className="px-5 py-3 font-medium">{t("columns.status")}</th>
                  <th className="px-5 py-3 font-medium">{t("columns.usage")}</th>
                </tr>
              </thead>
              <tbody>
                {history.cycles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-app-text-tertiary">
                      {t("noCycles")}
                    </td>
                  </tr>
                )}
                {history.cycles.map((c, i) => {
                  const status: CycleStatus = c.status in STATUS_TONE ? (c.status as CycleStatus) : "OPEN";
                  // A package reads as its size and how much of it went,
                  // like the hours screen (12.10.2026).
                  const f =
                    c.kind === "PREPAID"
                      ? packageFigures(c.purchasedMinutes, c.remainingMinutes)
                      : bankFigures(c.totalMinutes, c.consumedMinutes);
                  return (
                    <tr key={i} className="border-b border-app-border last:border-0">
                      <td className="px-5 py-3 text-app-text-secondary">
                        <span className="block text-[11px] text-app-text-tertiary">{c.kind === "PREPAID" ? t("kind.package") : t("kind.cycle")}</span>
                        {formatDate(c.cycleStart)}
                      </td>
                      <td className="px-5 py-3 text-app-text-secondary">{formatDate(c.cycleEnd)}</td>
                      <td className="px-5 py-3">
                        <StatusBadge label={t(`status.${status}`)} tone={STATUS_TONE[status]} />
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
          <h2 className="text-sm font-medium text-app-text-secondary">{t("reportsTitle")}</h2>
          <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
            <table className="w-full min-w-[560px] text-start text-sm">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-tertiary">
                  <th className="px-5 py-3 font-medium">{t("columns.reportType")}</th>
                  <th className="px-5 py-3 font-medium">{t("columns.period")}</th>
                  <th className="px-5 py-3 font-medium">{t("columns.sentOn")}</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {history.reportRuns.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-app-text-tertiary">
                      {t("noReports")}
                    </td>
                  </tr>
                )}
                {history.reportRuns.map((r) => (
                  <tr key={r.id} className="border-b border-app-border last:border-0">
                    <td className="px-5 py-3 text-app-text-primary">{reportLabel(r.reportType)}</td>
                    <td className="px-5 py-3 text-app-text-secondary">
                      {formatDate(r.periodStart)} - {formatDate(r.periodEnd)}
                    </td>
                    <td className="px-5 py-3 text-app-text-secondary">{formatInstant(r.sentAt)}</td>
                    <td className="px-5 py-3 text-end">
                      {r.reportType === "MONTHLY_DETAILED" && (
                        <a
                          href={`/api/portal/export?monthOffset=${monthOffsetFor(r.periodStart)}&format=pdf`}
                          className="text-xs text-app-text-accent hover:underline"
                        >
                          {t("download")}
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
            <h2 className="text-sm font-medium text-app-text-secondary">{t("recipientsTitle")}</h2>
            <p className="text-sm text-app-text-secondary">
              {t("recipientsIntro")}
            </p>
            <div className="space-y-3">
              {history.schedules.length === 0 && (
                <p className="rounded-xl border border-app-border bg-white px-5 py-6 text-center text-sm text-app-text-tertiary">
                  {t("noSchedules")}
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
