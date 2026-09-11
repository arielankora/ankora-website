import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { runReport, REPORT_DEFINITIONS, type ReportType } from "@/lib/app-domain/reports";
import { listTimeEntriesForAdmin } from "@/lib/app-domain/time-entries";
import { listClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { listUsers } from "@/lib/app-domain/users";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { ReportFilterBar } from "./ReportFilterBar";
import { ClientSummaryFilterBar } from "./ClientSummaryFilterBar";
import { ClientSummaryView } from "./ClientSummaryView";
import { formatDuration, formatSource } from "@/lib/time-entry-format";
import { buildClientActivityPrompt, type ActivityPromptEntry } from "@/lib/client-activity-prompt";
import type { TimeEntrySource } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

// Overnight bug-hunt (docs/adr/0001 section 19.5): a "to" filter parsed as
// midnight excluded the entirety of the selected end date from every
// gte/lte range query in this file's callees - an admin filtering "this
// week" would silently lose the last day. "to" specifically needs the end
// of that day, not its start.
function parseDateEndOfDay(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T23:59:59.999`);
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

function formatEntryDateTime(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(
    d
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-֐-׿]+/g, "-");
}

// Spec 12 Admin screens table: "Reports - internal and client reports,
// schedule/send/export." Phase 5 (spec 23) covers the internal half only
// (schedule/send is Phase 6's scheduled-email territory, spec section 15).
//
// docs/adr/0001 section 19.14: added a second tab, "תקציר פעילות ללקוח" -
// unlike the numeric/tabular reports below, this compiles every raw time
// entry (incl. notes) for one client/period into a single AI-ready text
// block Ariel copies into ChatGPT/Claude to draft a client-facing update.
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: {
    tab?: string;
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

  const tab = searchParams.tab === "summary" ? "summary" : "numeric";
  const clients = await listClients();
  const activeClients = clients.filter((c) => c.status === "ACTIVE");

  const tabs = (
    <div className="flex gap-2 border-b border-lineDark">
      <Link
        href="/app/reports"
        className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
          tab === "numeric" ? "border-gold text-navy" : "border-transparent text-navy/50 hover:text-navy"
        }`}
      >
        דוחות
      </Link>
      <Link
        href="/app/reports?tab=summary"
        className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
          tab === "summary" ? "border-gold text-navy" : "border-transparent text-navy/50 hover:text-navy"
        }`}
      >
        תקציר פעילות ללקוח
      </Link>
    </div>
  );

  if (tab === "summary") {
    const clientId = searchParams.clientId || undefined;
    const from = parseDate(searchParams.from);
    const to = parseDateEndOfDay(searchParams.to);
    const client = clientId ? activeClients.find((c) => c.id === clientId) : undefined;

    let promptText: string | null = null;
    let filename = "";

    if (client) {
      const entries = await listTimeEntriesForAdmin({ clientId: client.id, from, to });

      const totalSeconds = entries.reduce((sum, e) => sum + (e.actualSeconds ?? 0), 0);

      const promptEntries: ActivityPromptEntry[] = entries.map((e) => ({
        dateLabel: formatEntryDateTime(e.startAt),
        userName: e.user.name,
        categoryName: e.category.name,
        durationLabel: formatDuration(e.actualSeconds),
        sourceLabel: formatSource(e.source),
        note: e.note,
        isEdited: e.isEdited,
      }));

      promptText = buildClientActivityPrompt({
        clientName: client.name,
        fromLabel: from ? from.toLocaleDateString("he-IL") : undefined,
        toLabel: to ? to.toLocaleDateString("he-IL") : undefined,
        entries: promptEntries,
        totalDurationLabel: formatDuration(totalSeconds),
      });

      const dateStr = new Date().toISOString().slice(0, 10);
      filename = sanitizeFilename(`client-summary_${client.name}_${dateStr}.txt`);
    }

    return (
      <AppShell user={user}>
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-medium text-navy">דוחות</h1>
            <p className="mt-1 text-sm text-navy/60">
              תקציר פעילות גולמי ללקוח נבחר, מוכן להדבקה ב-ChatGPT/Claude לצורך ניסוח סיכום לשיתוף עם הלקוח.
            </p>
          </div>

          {tabs}

          <ClientSummaryFilterBar
            clients={activeClients.map((c) => ({ id: c.id, name: c.name }))}
            current={{ clientId: searchParams.clientId, from: searchParams.from, to: searchParams.to }}
          />

          {!client && (
            <div className="rounded-2xl border border-lineDark bg-white px-5 py-8 text-center text-sm text-navy/50">
              בחרו לקוח כדי ליצור תקציר פעילות.
            </div>
          )}

          {client && promptText && <ClientSummaryView text={promptText} filename={filename} />}
        </div>
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
    to: parseDateEndOfDay(searchParams.to),
  };

  const [result, allCategories, users] = await Promise.all([runReport(user, type, filters), listCategories(), listUsers()]);

  const employees = users.filter((u) => u.role !== "CLIENT_USER" && u.status === "ACTIVE");

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">דוחות</h1>
          <p className="mt-1 text-sm text-navy/60">דוחות פנימיים לניהול, עם סינון וייצוא ל-CSV.</p>
        </div>

        {tabs}

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
