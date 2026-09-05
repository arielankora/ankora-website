import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getWeeklyActivity } from "@/lib/app-domain/client-portal";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";

export const metadata = { robots: { index: false, follow: false } };

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

// Spec 13's Weekly Activity: "משימות שבוצעו, שעות לפי משימה/קטגוריה,
// עובדים לפי הגדרת privacy."
export default async function PortalWeeklyPage({ searchParams }: { searchParams: { weekOffset?: string } }) {
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
        <AppShell user={user}>
          <Forbidden />
        </AppShell>
      );
    }
    throw err;
  }

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-medium text-navy">פעילות שבועית</h1>
            <p className="mt-1 text-sm text-navy/60">
              {formatDate(activity.from)} - {formatDate(new Date(activity.to.getTime() - 86_400_000))}
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <a
              href={`/app/portal/weekly?weekOffset=${weekOffset - 1}`}
              className="rounded-full border border-lineDark px-4 py-2 text-navy/70 hover:border-gold"
            >
              שבוע קודם
            </a>
            {weekOffset < 0 && (
              <a
                href={`/app/portal/weekly?weekOffset=${weekOffset + 1}`}
                className="rounded-full border border-lineDark px-4 py-2 text-navy/70 hover:border-gold"
              >
                שבוע הבא
              </a>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <p className="text-sm text-navy/60">
            סה&quot;כ שעות השבוע: <span className="font-medium text-navy">{Math.round(activity.totalMinutes / 6) / 10}</span>
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead>
              <tr className="border-b border-lineDark text-xs text-navy/50">
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
                  <td colSpan={activity.showEmployeeNames ? 5 : 4} className="px-5 py-8 text-center text-navy/50">
                    אין עדיין דיווחים לשבוע זה.
                  </td>
                </tr>
              )}
              {activity.rows.map((row, i) => (
                <tr key={i} className="border-b border-lineDark last:border-0">
                  <td className="px-5 py-3 text-navy/70">{row.date}</td>
                  <td className="px-5 py-3 text-navy/80">{row.activity}</td>
                  <td className="px-5 py-3 text-navy/70">{row.category}</td>
                  {activity.showEmployeeNames && <td className="px-5 py-3 text-navy/70">{row.employee}</td>}
                  <td className="px-5 py-3 text-navy/70">{row.billableMinutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
