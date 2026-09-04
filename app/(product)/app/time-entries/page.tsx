import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listTimeEntriesForAdmin } from "@/lib/app-domain/time-entries";
import { listClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { listUsers } from "@/lib/app-domain/users";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { FilterBar } from "./FilterBar";
import { AdminCreateEntryForm } from "./AdminCreateEntryForm";
import { AdminEntryRow } from "./AdminEntryRow";

export const metadata = { robots: { index: false, follow: false } };

const TIMEZONE = "Asia/Jerusalem";

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

// Spec 12 Admin screens table: "Time Entries - cross-client table +
// filters + edits + revisions."
export default async function AdminTimeEntriesPage({
  searchParams,
}: {
  searchParams: { clientId?: string; userId?: string; from?: string; to?: string };
}) {
  const user = await requireUser();

  if (!can(user.role, "time_entry.edit_others")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const from = parseDate(searchParams.from);
  const to = parseDate(searchParams.to);

  const [entries, clients, allCategories, users] = await Promise.all([
    listTimeEntriesForAdmin({
      clientId: searchParams.clientId || undefined,
      userId: searchParams.userId || undefined,
      from,
      to,
    }),
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
          <h1 className="text-xl font-medium text-navy">דיווחי זמן</h1>
          <p className="mt-1 text-sm text-navy/60">טבלה חוצת לקוחות, עם עריכה והיסטוריית שינויים.</p>
        </div>

        <FilterBar
          clients={activeClients.map((c) => ({ id: c.id, name: c.name }))}
          users={employees.map((u) => ({ id: u.id, name: u.name }))}
          current={searchParams}
        />

        <AdminCreateEntryForm
          users={employees.map((u) => ({ id: u.id, name: u.name }))}
          clients={activeClients.map((c) => ({ id: c.id, name: c.name }))}
          categories={allCategories
            .filter((cat) => cat.active)
            .map((cat) => ({ id: cat.id, name: cat.name, clientId: cat.clientId }))}
        />

        <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
          <table className="w-full min-w-[900px] text-start text-sm">
            <thead>
              <tr className="border-b border-lineDark text-xs text-navy/50">
                <th className="px-5 py-3 font-medium">תאריך</th>
                <th className="px-5 py-3 font-medium">עובד</th>
                <th className="px-5 py-3 font-medium">לקוח</th>
                <th className="px-5 py-3 font-medium">קטגוריה</th>
                <th className="px-5 py-3 font-medium">משך</th>
                <th className="px-5 py-3 font-medium">מקור</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-navy/50">
                    אין דיווחים התואמים את הסינון.
                  </td>
                </tr>
              )}
              {entries.map((entry) => (
                <AdminEntryRow
                  key={entry.id}
                  entry={{
                    id: entry.id,
                    startAt: entry.startAt.toISOString(),
                    endAt: entry.endAt?.toISOString() ?? null,
                    actualSeconds: entry.actualSeconds,
                    note: entry.note,
                    isEdited: entry.isEdited,
                    source: entry.source,
                    userName: entry.user.name,
                    clientName: entry.client.name,
                    categoryName: entry.category.name,
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
