import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalDashboard, getCategorySummary, getWeeklyActivity } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { PortalTabs } from "./PortalTabs";

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

const CATEGORY_BAR_COLORS = ["bg-gold", "bg-gold-light", "bg-gold/50"];

// Spec 13's Client Portal Dashboard + Category Summary, combined on one
// screen (both are compact "at a glance" views). App redesign (handoff
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
export default async function PortalDashboardPage() {
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

  const { client, snapshot, daysUntilCycleEnd } = dashboard;
  const totalCategoryMinutes = categorySummary.rows.reduce((s, r) => s + r.minutes, 0);

  return (
    <div className="space-y-4">
      <PortalTabs active="dash" />

      <div className="rounded-[20px] border border-gold/28 bg-[#FBF7F0] p-6 sm:p-7">
        <p className="text-xl font-medium text-appNavy">שלום, {client.name}</p>
        {snapshot ? (
          <p className="mt-1.5 text-[13.5px] text-appNavy/60">
            מחזור נוכחי: {formatDate(snapshot.bank.cycleStart)} – {formatDate(snapshot.bank.cycleEnd)}
            {daysUntilCycleEnd !== null && ` · ${daysUntilCycleEnd} ימים לסיום`}
          </p>
        ) : (
          <p className="mt-1.5 text-[13.5px] text-appNavy/60">טרם הוגדר מחזור בנק שעות. פנו למנהל התיק שלכם ב-Ankora.</p>
        )}

        {snapshot && (
          <>
            <div className="mt-[22px] grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <div className="rounded-[14px] border border-lineDark bg-white p-4">
                <span className="text-xs text-appNavy/55">סה&quot;כ בבנק</span>
                <p className="mt-2 font-jbmono text-2xl text-appNavy">{formatMinutes(snapshot.utilization.totalMinutes)}</p>
              </div>
              <div className="rounded-[14px] border border-lineDark bg-white p-4">
                <span className="text-xs text-appNavy/55">נוצל</span>
                <p className="mt-2 font-jbmono text-2xl text-appNavy">{formatMinutes(snapshot.utilization.consumedMinutes)}</p>
              </div>
              <div className="rounded-[14px] border border-lineDark bg-white p-4">
                <span className="text-xs text-appNavy/55">נותר</span>
                <p
                  dir="ltr"
                  className={`mt-2 text-end font-jbmono text-2xl ${
                    snapshot.utilization.remainingMinutes < 0 ? "text-error" : "text-appNavy"
                  }`}
                >
                  {formatMinutes(snapshot.utilization.remainingMinutes)}
                </p>
              </div>
              <div className="rounded-[14px] border border-lineDark bg-white p-4">
                <span className="text-xs text-appNavy/55">ניצול</span>
                <p className={`mt-2 font-jbmono text-2xl ${snapshot.utilization.utilizationPct > 100 ? "text-error" : "text-appNavy"}`}>
                  {snapshot.utilization.utilizationPct}%
                </p>
                <p className="mt-1 text-[11.5px] text-appNavy/50">
                  {formatMinutes(snapshot.utilization.consumedMinutes)} שעות מתוך {formatMinutes(snapshot.utilization.totalMinutes)}
                </p>
              </div>
            </div>
            <div className="mt-[18px] h-2.5 overflow-hidden rounded-full bg-appNavy/8">
              <span
                className={`block h-full ${snapshot.utilization.utilizationPct > 100 ? "bg-error" : "bg-gold-gradient"}`}
                style={{ width: `${Math.min(100, snapshot.utilization.utilizationPct)}%` }}
              />
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="rounded-2xl border border-lineDark bg-white p-5">
          <p className="mb-4 text-[13.5px] font-medium text-appNavy">פילוח לפי תחום · החודש</p>
          {categorySummary.rows.length === 0 ? (
            <p className="text-sm text-appNavy/50">אין עדיין נתונים לחודש הנוכחי.</p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {categorySummary.rows.map((row, i) => (
                <div key={row.category}>
                  <div className="flex justify-between text-sm">
                    <span className="text-appNavy">{row.category}</span>
                    <span className="font-jbmono text-appNavy/60">
                      {formatMinutes(row.minutes)} · {row.pctOfTotal}%
                    </span>
                  </div>
                  <span className="mt-1.5 block h-1.5 rounded-full bg-appNavy/7">
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

        <div className="overflow-hidden rounded-2xl border border-lineDark bg-white">
          <div className="flex items-center justify-between border-b border-lineDark px-[18px] py-3.5">
            <span className="text-[13.5px] font-medium text-appNavy">פעילות השבוע</span>
            <Link href="/app/portal/monthly" className="text-xs text-gold-dim hover:underline">
              הורדת דוח חודשי
            </Link>
          </div>
          {weekly.topActivities.length === 0 ? (
            <p className="px-[18px] py-8 text-center text-sm text-appNavy/50">אין עדיין פעילות השבוע.</p>
          ) : (
            weekly.topActivities.map((a, i) => (
              <div
                key={a.activity}
                className={`flex justify-between gap-2.5 px-[18px] py-3 text-sm ${
                  i < weekly.topActivities.length - 1 ? "border-b border-lineDark/60" : ""
                }`}
              >
                <span className="text-appNavy">{a.activity}</span>
                <span className="font-jbmono text-appNavy/60">{formatMinutes(a.minutes)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
