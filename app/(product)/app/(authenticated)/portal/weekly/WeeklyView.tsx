import { requireUser } from "@/lib/app-auth/session";
import { parsePeriodOffset, MAX_WEEK_OFFSET } from "@/lib/period-offset";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getWeeklyActivity } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { ViewTabs } from "@/components/app/ViewTabs";
import { HOURS_TABS } from "../hours/tabs";
import { formatDecimalHours } from "@/lib/hours-format";

const WEEKDAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

// 11.11.2026 (Hadas's portal review): decimal hours, like the "שעות" tab
// and the bank. 5:12 here beside 5.20 there read as two different numbers
// for the same work.
function formatHours(minutes: number) {
  return formatDecimalHours(minutes);
}

function formatDay(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

// Spec 13's Weekly Activity. App redesign (handoff README, screen 16): a
// 7-bar chart (Sun-Sat, tallest bar = today's peak) plus a "מה נעשה
// השבוע" list - see lib/app-domain/client-portal.ts's dailyTotals/
// topActivities comment for why the list shows real per-activity totals
// rather than the prototype's invented narrative lines.
// 20.10.2026: a view of the hours screen (?view=weekly), no longer a page.
export async function WeeklyView({ searchParams }: { searchParams: { weekOffset?: string; day?: string } }) {
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
  // 11.11.2026 (Hadas's portal review): a click on a day narrows the list
  // and the table below to that day; a second click on it, or the link in
  // the list's header, shows the whole week again. Plain links, so the day
  // is in the address and survives a refresh. Only a day of the week on
  // screen counts; anything else in ?day= is ignored.
  const selectedDay = activity.dailyTotals.some((d) => d.date === searchParams.day) ? searchParams.day : undefined;
  const weekHref = (extra: string = "") => `/app/portal/hours?view=weekly${weekOffset ? `&weekOffset=${weekOffset}` : ""}${extra}`;
  const listActivities = selectedDay ? activity.activitiesByDay[selectedDay] ?? [] : activity.topActivities;
  const rows = selectedDay ? activity.rows.filter((r) => r.date === selectedDay) : activity.rows;

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
          <span className="text-[11.5px] text-app-text-tertiary">לחיצה על יום מציגה רק אותו</span>
        </div>
        <div className="mt-[18px] grid h-[120px] grid-cols-7 items-end gap-2">
          {activity.dailyTotals.map((d, i) => {
            const isSelected = d.date === selectedDay;
            return (
              <a
                key={d.date}
                href={isSelected ? weekHref() : weekHref(`&day=${d.date}`)}
                aria-current={isSelected ? "true" : undefined}
                aria-label={`${WEEKDAY_SHORT[i]} ${formatDay(d.date)}: ${formatHours(d.minutes)} שעות`}
                className="group flex h-full flex-col justify-end"
              >
                <span
                  className={`rounded-t-md transition-colors ${
                    isSelected
                      ? "bg-app-accent"
                      : d.minutes > 0
                        ? selectedDay
                          ? "bg-gold/30 group-hover:bg-gold/60"
                          : "bg-gold/60 group-hover:bg-gold/80"
                        : "bg-app-surface-sunken"
                  }`}
                  style={{ height: `${Math.max(4, (d.minutes / maxMinutes) * 100)}%` }}
                  title={`${formatDay(d.date)}: ${formatHours(d.minutes)}`}
                />
              </a>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2 text-center text-[11px] text-app-text-tertiary">
          {activity.dailyTotals.map((d, i) => (
            <span key={d.date} className={d.date === selectedDay ? "font-medium text-app-text-primary" : undefined}>
              {WEEKDAY_SHORT[i]}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-app-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-app-border px-5 py-3.5">
          <span className="text-[13.5px] font-medium text-app-text-primary">
            {selectedDay ? `מה נעשה ב${formatDay(selectedDay)}` : "מה נעשה השבוע"}
          </span>
          {selectedDay && (
            <a href={weekHref()} className="text-xs text-app-text-accent hover:underline">
              כל השבוע
            </a>
          )}
        </div>
        {listActivities.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-app-text-tertiary">
            {selectedDay ? "אין דיווחים ליום הזה." : "אין עדיין דיווחים לשבוע זה."}
          </p>
        ) : (
          listActivities.map((a, i) => (
            <div
              key={a.activity}
              className={`flex justify-between px-5 py-3 text-sm ${i < listActivities.length - 1 ? "border-b border-app-border" : ""}`}
            >
              <span className="text-app-text-primary">{a.activity}</span>
              <span dir="ltr" className="font-jbmono text-app-text-secondary">
                {formatHours(a.minutes)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Spec 14.1's row-per-entry detail, so a client can check line by
          line. 11.11.2026 (Hadas's portal review): no employee column and no
          minutes; the time is in decimal hours like every other figure on
          the hours screens. The export (bottom of "שעות") still carries the
          minutes, and the employee where client.portalShowEmployeeNames is on. */}
      <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
        <table className="w-full min-w-[560px] text-start text-sm">
          <thead>
            <tr className="border-b border-app-border text-xs text-app-text-tertiary">
              <th className="px-5 py-3 font-medium">תאריך</th>
              <th className="px-5 py-3 font-medium">פעילות</th>
              <th className="px-5 py-3 font-medium">קטגוריה</th>
              <th className="px-5 py-3 font-medium">שעות</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-app-text-tertiary">
                  {selectedDay ? "אין דיווחים ליום הזה." : "אין עדיין דיווחים לשבוע זה."}
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-app-border last:border-0">
                <td className="px-5 py-3 text-app-text-secondary">{row.date}</td>
                <td className="px-5 py-3 text-app-text-primary">{row.activity}</td>
                <td className="px-5 py-3 text-app-text-secondary">{row.category}</td>
                <td className="px-5 py-3 font-jbmono text-app-text-secondary">
                  <span dir="ltr">{formatHours(row.billableMinutes)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
