import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getWeeklyActivity } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { PortalTabs } from "../PortalTabs";

export const metadata = { robots: { index: false, follow: false } };

const WEEKDAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// Spec 13's Weekly Activity. App redesign (handoff README, screen 16): a
// 7-bar chart (Sun-Sat, tallest bar = today's peak) plus a "מה נעשה
// השבוע" list - see lib/app-domain/client-portal.ts's dailyTotals/
// topActivities comment for why the list shows real per-activity totals
// rather than the prototype's invented narrative lines.
export default async function PortalWeeklyPage(props: { searchParams: Promise<{ weekOffset?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

  const weekOffset = Number(searchParams.weekOffset || 0);
  const referenceDate = new Date();
  referenceDate.setUTCDate(referenceDate.getUTCDate() + weekOffset * 7);

  let activity;
  try {
    activity = await getWeeklyActivity(user, referenceDate);
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

  const maxMinutes = Math.max(1, ...activity.dailyTotals.map((d) => d.minutes));

  return (
    <div className="space-y-4">
      <PortalTabs active="week" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-appNavy">פעילות שבועית</h1>
          <p className="mt-1 text-sm text-appNavy/60">
            {formatDate(activity.from)} – {formatDate(new Date(activity.to.getTime() - 86_400_000))}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <a
            href={`/app/portal/weekly?weekOffset=${weekOffset - 1}`}
            className="rounded-full border border-lineDark px-4 py-2 text-appNavy/70 hover:border-gold"
          >
            שבוע קודם
          </a>
          {weekOffset < 0 && (
            <a
              href={`/app/portal/weekly?weekOffset=${weekOffset + 1}`}
              className="rounded-full border border-lineDark px-4 py-2 text-appNavy/70 hover:border-gold"
            >
              שבוע הבא
            </a>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-lineDark bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <span className="text-sm text-appNavy/60">
            סה&quot;כ{" "}
            <span dir="ltr" className="font-jbmono text-sm text-appNavy">
              {formatHours(activity.totalMinutes)}
            </span>
          </span>
        </div>
        <div className="mt-[18px] grid h-[120px] grid-cols-7 items-end gap-2">
          {activity.dailyTotals.map((d) => (
            <span key={d.date} className="flex h-full flex-col justify-end">
              <span
                className={`rounded-t-md ${d.minutes > 0 ? "bg-gold/60" : "bg-appNavy/10"}`}
                style={{ height: `${Math.max(4, (d.minutes / maxMinutes) * 100)}%` }}
                title={`${d.date}: ${formatHours(d.minutes)}`}
              />
            </span>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2 text-center text-[11px] text-appNavy/50">
          {WEEKDAY_SHORT.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-lineDark bg-white">
        <div className="border-b border-lineDark px-5 py-3.5 text-[13.5px] font-medium text-appNavy">מה נעשה השבוע</div>
        {activity.topActivities.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-appNavy/50">אין עדיין דיווחים לשבוע זה.</p>
        ) : (
          activity.topActivities.map((a, i) => (
            <div
              key={a.activity}
              className={`flex justify-between px-5 py-3 text-sm ${
                i < activity.topActivities.length - 1 ? "border-b border-lineDark/60" : ""
              }`}
            >
              <span className="text-appNavy">{a.activity}</span>
              <span dir="ltr" className="font-jbmono text-appNavy/60">
                {formatHours(a.minutes)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Spec 14.1's own row-per-entry requirement predates this redesign
          pass and stays intact regardless of the chart/summary above it -
          the prototype's simplified chart+list view is additive polish,
          not a replacement for real per-entry detail a client may want to
          check line by line. Only the employee column is conditional, same
          as before (client.portalShowEmployeeNames). */}
      <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead>
            <tr className="border-b border-lineDark text-xs text-appNavy/50">
              <th className="px-5 py-3 font-medium">תאריך</th>
              <th className="px-5 py-3 font-medium">פעילות</th>
              <th className="px-5 py-3 font-medium">קטגוריה</th>
              {activity.showEmployeeNames && <th className="px-5 py-3 font-medium">עובד</th>}
              <th className="px-5 py-3 font-medium">דקות לחיוב</th>
            </tr>
          </thead>
          <tbody>
            {activity.rows.length === 0 && (
              <tr>
                <td colSpan={activity.showEmployeeNames ? 5 : 4} className="px-5 py-8 text-center text-appNavy/50">
                  אין עדיין דיווחים לשבוע זה.
                </td>
              </tr>
            )}
            {activity.rows.map((row, i) => (
              <tr key={i} className="border-b border-lineDark last:border-0">
                <td className="px-5 py-3 text-appNavy/70">{row.date}</td>
                <td className="px-5 py-3 text-appNavy/80">{row.activity}</td>
                <td className="px-5 py-3 text-appNavy/70">{row.category}</td>
                {activity.showEmployeeNames && <td className="px-5 py-3 text-appNavy/70">{row.employee}</td>}
                <td className="px-5 py-3 text-appNavy/70">{row.billableMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
