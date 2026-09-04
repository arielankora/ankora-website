import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { CreateClientForm } from "./CreateClientForm";
import { archiveClientAction } from "./actions";

export const metadata = { robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, { label: string; tone: "green" | "amber" | "gray" }> = {
  ACTIVE: { label: "פעיל", tone: "green" },
  PAUSED: { label: "מושהה", tone: "amber" },
  ARCHIVED: { label: "בארכיון", tone: "gray" },
};

export default async function ClientsPage() {
  const user = await requireUser();

  if (!can(user.role, "client.manage")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const clients = await listClients();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">לקוחות</h1>
          <p className="mt-1 text-sm text-navy/60">ניהול לקוחות Ankora, סטטוס וקטגוריות משויכות.</p>
        </div>

        <CreateClientForm />

        <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead>
              <tr className="border-b border-lineDark text-xs text-navy/50">
                <th className="px-5 py-3 font-medium">שם</th>
                <th className="px-5 py-3 font-medium">סטטוס</th>
                <th className="px-5 py-3 font-medium">אזור זמן</th>
                <th className="px-5 py-3 font-medium">קטגוריות</th>
                <th className="px-5 py-3 font-medium">משתמשים מוקצים</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-navy/50">
                    אין עדיין לקוחות. הוסיפו לקוח ראשון למעלה.
                  </td>
                </tr>
              )}
              {clients.map((client) => {
                const status = STATUS_LABEL[client.status] ?? STATUS_LABEL.ACTIVE;
                return (
                  <tr key={client.id} className="border-b border-lineDark last:border-0">
                    <td className="px-5 py-3">
                      <Link href={`/app/clients/${client.id}`} className="font-medium text-navy hover:text-gold-dim">
                        {client.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge label={status.label} tone={status.tone} />
                    </td>
                    <td className="px-5 py-3 text-navy/70">{client.timezone}</td>
                    <td className="px-5 py-3 text-navy/70">{client._count.categories}</td>
                    <td className="px-5 py-3 text-navy/70">{client._count.employeeAccess}</td>
                    <td className="px-5 py-3 text-end">
                      {client.status !== "ARCHIVED" && (
                        <form action={archiveClientAction}>
                          <input type="hidden" name="clientId" value={client.id} />
                          <button type="submit" className="text-xs text-navy/50 hover:text-red-600">
                            העברה לארכיון
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
