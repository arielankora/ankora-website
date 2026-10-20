import { requireUser } from "@/lib/app-auth/session";
import { parsePeriodOffset, MAX_WEEK_OFFSET } from "@/lib/period-offset";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getWeeklyActivity } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { ViewTabs } from "@/components/app/ViewTabs";
import { HOURS_TABS } from "../hours/tabs";
import { formatClockMinutes } from "@/lib/hours-format";

const WEEKDAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

function formatHours(minutes: number) {
  return formatClockMinutes(minutes);
}

// Spec 13's Weekly Activity. App redesign (handoff README, screen 16): a
// 7-bar chart (Sun-Sat, tallest bar = today's peak) plus a "מה נעשה
// השבוע" list - see lib/app-domain/client-portal.ts's dailyTotals/
// topActivities comment for why the list shows real per-activity totals
// rather than the prototype's invented narrative lines.
// 20.10.2026: a view of the hours screen (?view=weekly), no longer a page.
export async function WeeklyView({ searchParams }: { searchParams: { weekOffset?: string } }) {
  const user = await requireUser();

  const weekOffset = parsePeriodOffset(searchParams.weekOffset, MAX_WEEK_OFFSET);
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
      <ViewTabs label="שעות ודוחות" active="weekly" tabs={HOURS_TABS} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">פעילות שבועית</h1>
          <p className="mt-1 text-sm text-app-text-secondary">
            {formatDate(activity.from)} עד {formatDate(new Date(activity.to.getTime() - 86_400_000))}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <a
            href={`/app/portal/hours?view=weekly&weekOffset=${weekOffset - 1}`}
            className="rounded-full border border-app-border-strong px-4 py-2 text-app-text-primary hover:border-app-accent"
          >
            שבוע קודם
          </a>
          {weekOffset < 0 && (
            <a
              href={`/app/portal/hours?view=weekly&weekOffset=${weekOffset + 1}`}
              className="rounded-full border border-app-border-strong px-4 py-2 text-app-text-primary hover:border-app-accent"
            >
              שבוע הבא
            </a>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-app-border bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <span className="text-sm text-app-text-secondary">
            סה&quot;כ{" "}
            <span dir="ltr" className="font-jbmono text-sm text-app-text-primary">
              {formatHours(activity.totalMinutes)}
            </span>
          </span>
        </div>
        <div className="mt-[18px] grid h-[120px] grid-cols-7 items-end gap-2">
          {activity.dailyTotals.map((d) => (
            <span key={d.date} className="flex h-full flex-col justify-end">
              <span
                className={`rounded-t-md ${d.minutes > 0 ? "bg-gold/60" : "bg-app-surface-sunken"}`}
                style={{ height: `${Math.max(4, (d.minutes / maxMinutes) * 100)}%` }}
                title={`${d.date}: ${formatHours(d.minutes)}`}
              />
            </span>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2 text-center text-[11px] text-app-text-tertiary">
          {WEEKDAY_SHORT.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-app-border bg-white">
        <div className="border-b border-app-border px-5 py-3.5 text-[13.5px] font-medium text-app-text-primary">מה נעשה השבוע</div>
        {activity.topActivities.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-app-text-tertiary">אין עדיין דיווחים לשבוע זה.</p>
        ) : (
          activity.topActivities.map((a, i) => (
            <div
              key={a.activity}
              className={`flex justify-between px-5 py-3 text-sm ${
                i < activity.topActivities.length - 1 ? "border-b border-app-border" : ""
              }`}
            >
              <span className="text-app-text-primary">{a.activity}</span>
              <span dir="ltr" className="font-jbmono text-app-text-secondary">
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
      <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead>
            <tr className="border-b border-app-border text-xs text-app-text-tertiary">
              <th className="px-5 py-3 font-medium">תאריך</th>
              <th className="px-5 py-3 font-medium">פעילות</th>
              <th className="px-5 py-3 font-medium">קטגוריה</th>
              {activity.showEmployeeNames && <th className="px-5 py-3 font-medium">איש צוות</th>}
              <th className="px-5 py-3 font-medium">דקות לחיוב</th>
            </tr>
          </thead>
          <tbody>
            {activity.rows.length === 0 && (
              <tr>
                <td colSpan={activity.showEmployeeNames ? 5 : 4} className="px-5 py-8 text-center text-app-text-tertiary">
                  אין עדיין דיווחים לשבוע זה.
                </td>
              </tr>
            )}
            {activity.rows.map((row, i) => (
              <tr key={i} className="border-b border-app-border last:border-0">
                <td className="px-5 py-3 text-app-text-secondary">{row.date}</td>
                <td className="px-5 py-3 text-app-text-primary">{row.activity}</td>
                <td className="px-5 py-3 text-app-text-secondary">{row.category}</td>
                {activity.showEmployeeNames && <td className="px-5 py-3 text-app-text-secondary">{row.employee}</td>}
                <td className="px-5 py-3 text-app-text-secondary">{row.billableMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
