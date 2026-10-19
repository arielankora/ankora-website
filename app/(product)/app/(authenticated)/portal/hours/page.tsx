import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalDashboard, getCategorySummary, getWeeklyActivity } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { PortalTabs } from "../PortalTabs";
import { bankFigures, formatDecimalHours, packageFigures } from "@/lib/hours-format";
import { describeForecast } from "@/lib/prepaid-format";

export const metadata = { robots: { index: false, follow: false } };

// Decimal hours, like the internal bank screen and like the package the
// client bought (lib/hours-format.ts). "3:04" beside "11:56" reads as two
// decimals that do not add up; "3.07" beside "11.93" does. Every figure on
// this screen goes through formatDecimalHours or bankFigures.
function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

const CATEGORY_BAR_COLORS = ["bg-gold", "bg-gold-light", "bg-gold/50"];

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
export default async function PortalHoursPage() {
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

  return (
    <div className="space-y-4">
      <PortalTabs active="hours" />

      <div className="rounded-[20px] border border-gold/28 bg-app-surface-sunken p-6 sm:p-7">
        <p className="text-xl font-medium text-app-text-primary">שלום, {client.name}</p>
        {snapshot && isPrepaid ? (
          <div className="mt-1.5 space-y-1 text-[13.5px] text-app-text-secondary">
            <p>
              חבילת שעות שנטענה ב-{formatDate(snapshot.bank.cycleStart)} · בתוקף עד {formatDate(snapshot.bank.cycleEnd)}
              {daysUntilCycleEnd !== null && ` · ${daysUntilCycleEnd} ימים לסיום התוקף`}
            </p>
            {forecastText && <p className="text-app-text-secondary">{forecastText}</p>}
          </div>
        ) : snapshot ? (
          <p className="mt-1.5 text-[13.5px] text-app-text-secondary">
            מחזור נוכחי: {formatDate(snapshot.bank.cycleStart)} עד {formatDate(snapshot.bank.cycleEnd)}
            {daysUntilCycleEnd !== null && ` · ${daysUntilCycleEnd} ימים לסיום`}
          </p>
        ) : (
          <p className="mt-1.5 text-[13.5px] text-app-text-secondary">טרם הוגדר מחזור בנק שעות. פנו למנהל התיק שלכם ב-Ankora.</p>
        )}

        {snapshot && figures && (
          <>
            <div className="mt-[22px] grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <div className="rounded-[14px] border border-app-border bg-white p-4">
                <span className="text-xs text-app-text-secondary">{isPrepaid ? "גודל החבילה" : <>סה&quot;כ בבנק</>}</span>
                <p className="mt-2 font-jbmono text-2xl text-app-text-primary">{figures.total}</p>
              </div>
              <div className="rounded-[14px] border border-app-border bg-white p-4">
                <span className="text-xs text-app-text-secondary">נוצל</span>
                <p className="mt-2 font-jbmono text-2xl text-app-text-primary">{figures.consumed}</p>
              </div>
              <div className="rounded-[14px] border border-app-border bg-white p-4">
                <span className="text-xs text-app-text-secondary">נותר</span>
                {/* <bdi dir="ltr"> keeps a negative balance's minus on the left
                    while the figure stays aligned under its label, like the
                    other three tiles. */}
                <p className={`mt-2 font-jbmono text-2xl ${figures.overdrawn ? "text-app-error" : "text-app-text-primary"}`}>
                  <bdi dir="ltr">{figures.remaining}</bdi>
                </p>
              </div>
              <div className="rounded-[14px] border border-app-border bg-white p-4">
                <span className="text-xs text-app-text-secondary">ניצול</span>
                <p className={`mt-2 font-jbmono text-2xl ${snapshot.utilization.utilizationPct > 100 ? "text-app-error" : "text-app-text-primary"}`}>
                  {snapshot.utilization.utilizationPct}%
                </p>
                <p className="mt-1 text-[11.5px] text-app-text-tertiary">
                  {figures.consumed} שעות מתוך {figures.total}
                </p>
              </div>
            </div>
            <div className="mt-[18px] h-2.5 overflow-hidden rounded-full bg-app-surface-sunken">
              <span
                className={`block h-full ${snapshot.utilization.utilizationPct > 100 ? "bg-app-error" : "bg-gold-gradient"}`}
                style={{ width: `${Math.min(100, snapshot.utilization.utilizationPct)}%` }}
              />
            </div>
            {isPrepaid && carry !== 0 && (
              <p className="mt-3 text-[12px] text-app-text-secondary">
                {carry < 0 ? "כולל קיזוז של " : "כולל יתרה של "}
                <bdi dir="ltr">{formatDecimalHours(Math.abs(carry))}</bdi>
                {carry < 0 ? " שעות שנוצלו מעבר לחבילה הקודמת." : " שעות שעברו מהחבילה הקודמת ומנוצלות ראשונות."}
              </p>
            )}
            <p className="mt-3 text-[11.5px] text-app-text-tertiary">בשעות עשרוניות: 0.50 הן חצי שעה, 0.25 הן רבע שעה.</p>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="rounded-2xl border border-app-border bg-white p-5">
          <p className="mb-4 text-[13.5px] font-medium text-app-text-primary">פילוח לפי תחום · החודש</p>
          {categorySummary.rows.length === 0 ? (
            <p className="text-sm text-app-text-tertiary">אין עדיין נתונים לחודש הנוכחי.</p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {categorySummary.rows.map((row, i) => (
                <div key={row.category}>
                  <div className="flex justify-between text-sm">
                    <span className="text-app-text-primary">{row.category}</span>
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
            <span className="text-[13.5px] font-medium text-app-text-primary">פעילות השבוע</span>
            <div className="flex items-center gap-3">
              <Link href="/app/portal/weekly" className="text-xs text-app-text-accent hover:underline">
                לפי ימים
              </Link>
              <Link href="/app/portal/monthly" className="text-xs text-app-text-accent hover:underline">
                הורדת דוח חודשי
              </Link>
            </div>
          </div>
          {weekly.topActivities.length === 0 ? (
            <p className="px-[18px] py-8 text-center text-sm text-app-text-tertiary">אין עדיין פעילות השבוע.</p>
          ) : (
            weekly.topActivities.map((a, i) => (
              <div
                key={a.activity}
                className={`flex justify-between gap-2.5 px-[18px] py-3 text-sm ${
                  i < weekly.topActivities.length - 1 ? "border-b border-app-border" : ""
                }`}
              >
                <span className="text-app-text-primary">{a.activity}</span>
                <span className="font-jbmono text-app-text-secondary">{formatDecimalHours(a.minutes)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
