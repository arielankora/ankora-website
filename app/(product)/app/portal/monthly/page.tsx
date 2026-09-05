import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getMonthlyDetailed } from "@/lib/app-domain/client-portal";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";

export const metadata = { robots: { index: false, follow: false } };

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

// Spec 13's Monthly Detailed report / spec 14.1's row: "שורה לכל
// Entry/Task: תאריך, משימה, קטגוריה, זמן לחיוב, סיכומים." + spec 14.4's
// mandatory CSV export ("CSV חובה... עברית חייבת להישאר קריאה").
export default async function PortalMonthlyPage({ searchParams }: { searchParams: { monthOffset?: string } }) {
  const user = await requireUser();

  const monthOffset = Number(searchParams.monthOffset || 0);
  const referenceDate = new Date();
  referenceDate.setUTCMonth(referenceDate.getUTCMonth() + monthOffset);

  let report;
  try {
    report = await getMonthlyDetailed(user, referenceDate);
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
            <h1 className="text-xl font-medium text-navy">דוח חודשי מפורט</h1>
            <p className="mt-1 text-sm text-navy/60">
              {formatDate(report.from)} - {formatDate(new Date(report.to.getTime() - 86_400_000))}
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <a
              href={`/app/portal/monthly?monthOffset=${monthOffset - 1}`}
              className="rounded-full border border-lineDark px-4 py-2 text-navy/70 hover:border-gold"
            >
              חודש קודם
            </a>
            {monthOffset < 0 && (
              <a
                href={`/app/portal/monthly?monthOffset=${monthOffset + 1}`}
                className="rounded-full border border-lineDark px-4 py-2 text-navy/70 hover:border-gold"
              >
                חודש הבא
              </a>
            )}
            <a
              href={`/api/portal/export?monthOffset=${monthOffset}`}
              className="rounded-full bg-gold-gradient px-4 py-2 font-medium text-ink"
            >
              ייצוא ל-CSV
            </a>
          </div>
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <p className="text-sm text-navy/60">
            סה&quot;כ שעות לחיוב החודש: <span className="font-medium text-navy">{Math.round(report.totalMinutes / 6) / 10}</span>
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead>
              <tr className="border-b border-lineDark text-xs text-navy/50">
                <th className="px-5 py-3 font-medium">תאריך</th>
                <th className="px-5 py-3 font-medium">פעילות</th>
                <th className="px-5 py-3 font-medium">קטגוריה</th>
                {report.showEmployeeNames && <th className="px-5 py-3 font-medium">עובד</th>}
                <th className="px-5 py-3 font-medium">דקות לחיוב</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={report.showEmployeeNames ? 5 : 4} className="px-5 py-8 text-center text-navy/50">
                    אין עדיין דיווחים לחודש זה.
                  </td>
                </tr>
              )}
              {report.rows.map((row, i) => (
                <tr key={i} className="border-b border-lineDark last:border-0">
                  <td className="px-5 py-3 text-navy/70">{row.date}</td>
                  <td className="px-5 py-3 text-navy/80">{row.activity}</td>
                  <td className="px-5 py-3 text-navy/70">{row.category}</td>
                  {report.showEmployeeNames && <td className="px-5 py-3 text-navy/70">{row.employee}</td>}
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
