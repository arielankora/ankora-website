import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { parsePeriodOffset, MAX_MONTH_OFFSET, israelMonthReference } from "@/lib/period-offset";
import { getPortalTaskReport } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { ViewTabs } from "@/components/app/ViewTabs";
import { HOURS_TABS } from "../hours/tabs";
import { PromiseList } from "../PromiseList";

function formatMonthTitle(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
}

// 11.11.2026 (Hadas's portal review): the "משימות" view of the hours screen
// (?view=tasks), in the place of the monthly report. How many tasks closed
// in a month and how many are still open, and the tasks themselves in the
// same row the home screen and the activity stream use (PromiseRow), so
// the client reads a task one way everywhere.
//
// The month moves only the closed list. Open tasks are always as of today.
export async function TasksView({ searchParams }: { searchParams: { monthOffset?: string } }) {
  const user = await requireUser();
  const monthOffset = parsePeriodOffset(searchParams.monthOffset, MAX_MONTH_OFFSET);
  const { referenceDate } = israelMonthReference(monthOffset);

  let report;
  try {
    report = await getPortalTaskReport(user, referenceDate);
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden />;
    throw err;
  }

  const month = formatMonthTitle(referenceDate);
  const monthHref = (offset: number) => `/app/portal/hours?view=tasks&monthOffset=${offset}`;

  return (
    <div className="space-y-4">
      <ViewTabs label="שעות ודוחות" active="tasks" tabs={HOURS_TABS} />

      <div className="rounded-2xl border border-app-border bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[15px] font-medium text-app-text-primary">משימות · {month}</h1>
          <div className="flex flex-wrap gap-2">
            <a
              href={monthHref(monthOffset - 1)}
              className="rounded-full border border-app-border-strong px-4 py-2 text-sm text-app-text-primary hover:border-app-accent"
            >
              חודש קודם
            </a>
            {monthOffset < 0 && (
              <a
                href={monthHref(monthOffset + 1)}
                className="rounded-full border border-app-border-strong px-4 py-2 text-sm text-app-text-primary hover:border-app-accent"
              >
                חודש הבא
              </a>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <a href="#closed" className="rounded-xl border border-app-border p-3.5 hover:border-app-accent">
            <span className="text-[11.5px] text-app-text-secondary">נסגרו ב{month}</span>
            <p className="mt-1.5 font-jbmono text-xl text-app-text-primary">{report.closed.length}</p>
          </a>
          <a href="#open" className="rounded-xl border border-app-border p-3.5 hover:border-app-accent">
            <span className="text-[11.5px] text-app-text-secondary">פתוחות היום</span>
            <p className="mt-1.5 font-jbmono text-xl text-app-text-primary">{report.open.length}</p>
          </a>
          <a href="#open" className="rounded-xl border border-app-border p-3.5 hover:border-app-accent">
            <span className="text-[11.5px] text-app-text-secondary">מחכות לך</span>
            <p className="mt-1.5 font-jbmono text-xl text-app-text-primary">{report.waitingOnClient}</p>
          </a>
        </div>
      </div>

      <div id="open" className="scroll-mt-6">
        <PromiseList title="משימות פתוחות" promises={report.open} emptyText="אין כרגע משימות פתוחות." />
      </div>
      <div id="closed" className="scroll-mt-6">
        <PromiseList title={`נסגרו ב${month}`} promises={report.closed} emptyText="לא נסגרו משימות בחודש הזה." showStage={false} />
      </div>
    </div>
  );
}
