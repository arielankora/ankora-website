import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { runReport, REPORT_DEFINITIONS, type ReportType } from "@/lib/app-domain/reports";
import { listClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { listUsers } from "@/lib/app-domain/users";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { ReportFilterBar } from "./ReportFilterBar";
import type { TimeEntrySource } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

function isReportType(value: string | undefined): value is ReportType {
  return REPORT_DEFINITIONS.some((r) => r.id === value);
}

function formatCell(value: string | number, type?: string): string {
  if (type === "percent") return `${value}%`;
  if (type === "minutes" && typeof value === "number") {
    const h = Math.floor(value / 60);
    const m = value % 60;
    return `${h}:${String(m).padStart(2, "0")}`;
  }
  return String(value);
}

// Spec 12 Admin screens table: "Reports - internal and client reports,
// schedule/send/export." Phase 5 (spec 23) covers the internal half only
// (schedule/send is Phase 6's scheduled-email territory, spec section 15).
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: {
    type?: string;
    clientId?: string;
    userId?: string;
    categoryId?: string;
    source?: string;
    editedOnly?: string;
    manualOnly?: string;
    from?: string;
    to?: string;
  };
}) {
  const user = await requireUser();

  if (!can(user.role, "report.internal.view")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const type: ReportType = isReportType(searchParams.type) ? searchParams.type : "total_client_hours";

  const filters = {
    clientId: searchParams.clientId || undefined,
    userId: searchParams.userId || undefined,
    categoryId: searchParams.categoryId || undefined,
    source: (searchParams.source as TimeEntrySource | undefined) || undefined,
    editedOnly: searchParams.editedOnly === "1",
    manualOnly: searchParams.manualOnly === "1",
    from: parseDate(searchParams.from),
    to: parseDate(searchParams.to),
  };

  const [result, clients, allCategories, users] = await Promise.all([
    runReport(user, type, filters),
    listClients(),
    listCategories(),
    listUsers(),
  ]);

  const activeClients = clients.filter((c) => c.status === "ACTIVE");
  const employees = users.filter((u) => u.role !== "CLIENT_USER" && u.status === "ACTIVE");

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">דוחות</h1>
          <p className="mt-1 text-sm text-navy/60">דוחות פנימיים לניהול, עם סינון וייצוא ל-CSV.</p>
        </div>

        <ReportFilterBar
          reportTypes={REPORT_DEFINITIONS.map((r) => ({ id: r.id, label: r.label }))}
          clients={activeClients.map((c) => ({ id: c.id, name: c.name }))}
          users={employees.map((u) => ({ id: u.id, name: u.name }))}
          categories={allCategories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
          current={{
            type,
            clientId: searchParams.clientId,
            userId: searchParams.userId,
            categoryId: searchParams.categoryId,
            source: searchParams.source,
            editedOnly: searchParams.editedOnly,
            manualOnly: searchParams.manualOnly,
            from: searchParams.from,
            to: searchParams.to,
          }}
        />

        <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
          <div className="border-b border-lineDark px-5 py-3">
            <h2 className="text-sm font-medium text-navy">{result.title}</h2>
          </div>
          <table className="w-full min-w-[700px] text-start text-sm">
            <thead>
              <tr className="border-b border-lineDark text-xs text-navy/50">
                {result.columns.map((col) => (
                  <th key={col.key} className="px-5 py-3 font-medium">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.length === 0 && (
                <tr>
                  <td colSpan={result.columns.length} className="px-5 py-8 text-center text-navy/50">
                    אין נתונים התואמים את הסינון.
                  </td>
                </tr>
              )}
              {result.rows.map((row, i) => (
                <tr key={i} className="border-b border-lineDark last:border-0">
                  {result.columns.map((col) => (
                    <td key={col.key} className="px-5 py-3 text-navy">
                      {formatCell(row[col.key], col.type)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
