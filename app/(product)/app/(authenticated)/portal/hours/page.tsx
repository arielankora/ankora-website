import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { TIMEZONE } from "@/lib/timezone";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalDashboard, getCategorySummary, getWeeklyActivity } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { ViewTabs } from "@/components/app/ViewTabs";
import { hoursTabs, MONTHLY_REPORT_ANCHOR } from "./tabs";
import { MonthlyReportSection } from "../monthly/MonthlyView";
import { WeeklyView } from "../weekly/WeeklyView";
import { TasksView } from "../tasks/TasksView";
import { carryQuery } from "@/components/app/ViewTabs";
import { parsePeriodOffset, MAX_MONTH_OFFSET } from "@/lib/period-offset";
import { bankFigures, formatDecimalHours, packageFigures } from "@/lib/hours-format";
import type { PrepaidForecast } from "@/lib/app-domain/hour-banks";
import { cycleElapsedShare } from "@/lib/app-domain/hour-banks";
import { ProgressBar } from "@/components/app/ProgressBar";

export const metadata = { robots: { index: false, follow: false } };

// Decimal hours, like the internal bank screen and like the package the
// client bought (lib/hours-format.ts). "3:04" beside "11:56" reads as two
// decimals that do not add up; "3.07" beside "11.93" does. Every figure on
// this screen goes through formatDecimalHours or bankFigures.

// 20.10.2026: four tones of the palette that differ in lightness, not three
// golds a client cannot tell apart.
const CATEGORY_BAR_COLORS = ["bg-app-surface-nav", "bg-app-info", "bg-app-accent", "bg-app-border-strong"];

// Spec 13's Client Portal Dashboard + Category Summary, combined on one
// screen (both are compact "at a glance" views).
//
// Portal phase 1 moved this screen from /app/portal to /app/portal/hours.
// Nothing on it changed: the hours are still exact, still reconciled with
// what Ankora sees internally, and still one click away. What changed is
// that they are no longer the first thing a client meets - the home screen
// now answers what is being handled and what is waiting on them, and the
// hours answer the question that comes after that one. App redesign (handoff
// README, screen 16): the hero card gets the design's one explicitly
// distinct treatment for the portal - `#FBF7F0` background + a gold
// border (`Design Tokens` table has no named token for this exact tint,
// so it's the one arbitrary hex value in this phase - everything else
// uses the shared gold/navy/cream tokens). The prototype's own amber
// "כך הלקוח רואה את הפורטל" banner is NOT reproduced here: that note is
// third-person ("this is how the client sees it"), written for an Ankora
// staff member toggling the SAME demo between an internal view and a
// client-view preview - this app has no "view portal as this client"
// staff impersonation feature (resolvePortalClient only ever resolves the
// caller's OWN ClientUser membership), so a real client landing on this
// page would find a banner describing them in the third person
// nonsensical. Isolation is still structural exactly as the README
// requires, just silent rather than announced.
export default async function PortalHoursPage(props: {
  searchParams: Promise<{ view?: string; monthOffset?: string; weekOffset?: string; day?: string }>;
}) {
  // 19.10.2026: hours and the monthly report, one screen (canvas "Ankora App UI Round").
  const sp = await props.searchParams;
  if (sp.view === "monthly") {
    // 11.11.2026: the monthly tab is gone (./tabs.ts); its address, in
    // bookmarks and in the e-mails, lands on the month's section below.
    const query = carryQuery(sp, ["monthOffset"], {});
    redirect(`/app/portal/hours${query ? `?${query}` : ""}#${MONTHLY_REPORT_ANCHOR}`);
  }
  if (sp.view === "weekly") return <WeeklyView searchParams={{ weekOffset: sp.weekOffset, day: sp.day }} />;
  if (sp.view === "tasks") return <TasksView searchParams={{ monthOffset: sp.monthOffset }} />;
  const monthOffset = parsePeriodOffset(sp.monthOffset, MAX_MONTH_OFFSET);
  const user = await requireUser();

  let dashboard;
  let categorySummary;
  let weekly;
  try {
    [dashboard, categorySummary, weekly] = await Promise.all([
      getPortalDashboard(user),
      getCategorySummary(user),
      getWeeklyActivity(user),
    ]);
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

  const t = await getTranslations("portal.hours");
  const format = await getFormatter();
  // ADR 0006: in the reader's language. A cycle starts and ends on Israeli
  // days, so they are written in Israel time wherever the reader is.
  const formatDate = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: TIMEZONE });
  // describeForecast (lib/prepaid-format.ts) says the same in Hebrew for
  // the reports and MCP; this is the screen's own wording.
  const describeForecast = (f: PrepaidForecast | null, timeZone: string): string | null => {
    if (!f) return null;
    switch (f.status) {
      case "depleted":
        return t("forecast.depleted");
      case "insufficient_data":
        return t("forecast.insufficientData");
      case "projected":
        return t("forecast.projected", {
          weekly: formatDecimalHours(f.weeklyMinutes),
          date: format.dateTime(f.depletionDate, { dateStyle: "medium", timeZone }),
        });
    }
  };
  const ltr = (chunks: React.ReactNode) => <bdi dir="ltr">{chunks}</bdi>;

  const { client, snapshot, daysUntilCycleEnd, forecast } = dashboard;
  const totalCategoryMinutes = categorySummary.rows.reduce((s, r) => s + r.minutes, 0);
  // 12.10.2026: a prepaid package reads as its size, how much of it is
  // used, and what is left, the same arithmetic as its percentage.
  const isPrepaid = snapshot?.bank.kind === "PREPAID";
  const figures = snapshot
    ? isPrepaid
      ? packageFigures(snapshot.bank.purchasedMinutes, snapshot.utilization.remainingMinutes)
      : bankFigures(snapshot.utilization.totalMinutes, snapshot.utilization.consumedMinutes)
    : null;
  const forecastText = describeForecast(forecast, client.timezone);
  const carry = snapshot?.bank.rolloverInMinutes ?? 0;
  // Where a cycle bank is expected to be today, the same tick the team sees
  // on its home screen. A package has no cycle to pace against: its answer
  // is the forecast line above.
  const pacePct =
    snapshot && !isPrepaid
      ? Math.round(cycleElapsedShare(snapshot.bank.cycleStart, snapshot.bank.cycleEnd, new Date()) * 100)
      : null;
  const usedPct = snapshot?.utilization.utilizationPct ?? 0;
  const paceWord =
    pacePct === null ? null : usedPct > pacePct + 5 ? t("pace.over") : usedPct < pacePct - 5 ? t("pace.under") : t("pace.on");

  return (
    <div className="space-y-4">
        <ViewTabs label={t("tabsLabel")} active="hours" tabs={hoursTabs((key) => t(`tabs.${key}`))} />

      <div className="rounded-[20px] border border-gold/28 bg-app-surface-sunken p-6 sm:p-7">
        <p className="text-base font-medium text-app-text-primary">{isPrepaid ? t("packageTitle") : t("cycleTitle")}</p>
        {snapshot && isPrepaid ? (
          <div className="mt-1.5 space-y-1 text-[13.5px] text-app-text-secondary">
            <p>
              {t("packageLoaded", { start: formatDate(snapshot.bank.cycleStart), end: formatDate(snapshot.bank.cycleEnd) })}
              {daysUntilCycleEnd !== null && ` · ${t("packageDaysLeft", { days: String(daysUntilCycleEnd) })}`}
            </p>
            {forecastText && <p className="text-app-text-secondary">{forecastText}</p>}
          </div>
        ) : snapshot ? (
          <p className="mt-1.5 text-[13.5px] text-app-text-secondary">
            {t("currentCycle", { start: formatDate(snapshot.bank.cycleStart), end: formatDate(snapshot.bank.cycleEnd) })}
            {daysUntilCycleEnd !== null && ` · ${t("cycleDaysLeft", { days: String(daysUntilCycleEnd) })}`}
          </p>
        ) : (
          <p className="mt-1.5 text-[13.5px] text-app-text-secondary">{t("noBank")}</p>
        )}

        {snapshot && figures && (
          <>
            <div className="mt-[22px] grid grid-cols-3 gap-3.5">
              <div className="rounded-[14px] border border-app-border bg-white p-4">
                <span className="text-xs text-app-text-secondary">{isPrepaid ? t("packageSize") : t("bankTotal")}</span>
                <p className="mt-2 font-jbmono text-2xl text-app-text-primary">{figures.total}</p>
              </div>
              <div className="rounded-[14px] border border-app-border bg-white p-4">
                <span className="text-xs text-app-text-secondary">{t("used")}</span>
                <p className="mt-2 font-jbmono text-2xl text-app-text-primary">{figures.consumed}</p>
              </div>
              <div className="rounded-[14px] border border-app-border bg-white p-4">
                <span className="text-xs text-app-text-secondary">{t("remaining")}</span>
                {/* <bdi dir="ltr"> keeps a negative balance's minus on the left
                    while the figure stays aligned under its label, like the
                    other three tiles. */}
                <p className={`mt-2 font-jbmono text-2xl ${figures.overdrawn ? "text-app-error" : "text-app-text-primary"}`}>
                  <bdi dir="ltr">{figures.remaining}</bdi>
                </p>
              </div>
            </div>
            <ProgressBar className="mt-[18px]" percent={usedPct} dangerAt={100.01} markerAt={pacePct ?? undefined} />
            <p className="mt-2 text-[12.5px] text-app-text-secondary">
              {t.rich("usedPct", { pct: String(usedPct), num: (chunks) => <span className="font-jbmono">{chunks}</span> })}
              {paceWord && <> · {paceWord} · {t("paceMarker")}</>}
            </p>
            {isPrepaid && carry !== 0 && (
              <p className="mt-3 text-[12px] text-app-text-secondary">
                {t.rich(carry < 0 ? "carryMinus" : "carryPlus", { hours: formatDecimalHours(Math.abs(carry)), h: ltr })}
              </p>
            )}
            <p className="mt-3 text-[11.5px] text-app-text-tertiary">{t("decimalNote")}</p>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="rounded-2xl border border-app-border bg-white p-5">
          <p className="mb-4 text-[13.5px] font-medium text-app-text-primary">{t("byCategory")}</p>
          {categorySummary.rows.length === 0 ? (
            <p className="text-sm text-app-text-tertiary">{t("noCategoryData")}</p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {categorySummary.rows.map((row, i) => (
                <div key={row.category}>
                  <div className="flex justify-between text-sm">
                    <span dir="auto" className="text-app-text-primary">
                      {row.category}
                    </span>
                    <span className="font-jbmono text-app-text-secondary">
                      {formatDecimalHours(row.minutes)} · {row.pctOfTotal}%
                    </span>
                  </div>
                  <span className="mt-1.5 block h-1.5 rounded-full bg-app-border">
                    <span
                      className={`block h-full rounded-full ${CATEGORY_BAR_COLORS[i % CATEGORY_BAR_COLORS.length]}`}
                      style={{ width: `${totalCategoryMinutes > 0 ? row.pctOfTotal : 0}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-app-border bg-white">
          <div className="flex items-center justify-between border-b border-app-border px-[18px] py-3.5">
            <span className="text-[13.5px] font-medium text-app-text-primary">{t("thisWeek")}</span>
            <Link href="/app/portal/hours?view=weekly" className="text-xs text-app-text-accent hover:underline">
              {t("byDays")}
            </Link>
          </div>
          {weekly.topActivities.length === 0 ? (
            <p className="px-[18px] py-8 text-center text-sm text-app-text-tertiary">{t("noActivityThisWeek")}</p>
          ) : (
            weekly.topActivities.map((a, i) => (
              <div
                key={a.activity}
                className={`flex justify-between gap-2.5 px-[18px] py-3 text-sm ${
                  i < weekly.topActivities.length - 1 ? "border-b border-app-border" : ""
                }`}
              >
                <span dir="auto" className="text-app-text-primary">
                  {a.activity}
                </span>
                <span className="font-jbmono text-app-text-secondary">{formatDecimalHours(a.minutes)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <MonthlyReportSection user={user} monthOffset={monthOffset} />
    </div>
  );
}
