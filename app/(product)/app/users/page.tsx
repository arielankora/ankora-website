import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listUsers } from "@/lib/app-domain/users";
import { listClients } from "@/lib/app-domain/clients";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { InviteUserForm } from "./InviteUserForm";

export const metadata = { robots: { index: false, follow: false } };

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "מנהל-על",
  ANKORA_ADMIN: "מנהל Ankora",
  ANKORA_EMPLOYEE: "עובד Ankora",
  CLIENT_USER: "לקוח",
};

const STATUS_LABEL: Record<string, { label: string; tone: "green" | "amber" | "gray" | "red" }> = {
  INVITED: { label: "הוזמן", tone: "amber" },
  ACTIVE: { label: "פעיל", tone: "green" },
  SUSPENDED: { label: "מושהה", tone: "red" },
  ARCHIVED: { label: "בארכיון", tone: "gray" },
};

export default async function UsersPage() {
  const user = await requireUser();

  if (!can(user.role, "user.manage")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const [users, clients] = await Promise.all([listUsers(), listClients()]);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">משתמשים</h1>
          <p className="mt-1 text-sm text-navy/60">צוות Ankora, תפקידים וגישה ללקוחות.</p>
        </div>

        <InviteUserForm clients={clients.filter((c) => c.status === "ACTIVE")} />

        <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead>
              <tr className="border-b border-lineDark text-xs text-navy/50">
                <th className="px-5 py-3 font-medium">שם</th>
                <th className="px-5 py-3 font-medium">תפקיד</th>
                <th className="px-5 py-3 font-medium">סטטוס</th>
                <th className="px-5 py-3 font-medium">גישה ללקוחות</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const status = STATUS_LABEL[u.status] ?? STATUS_LABEL.ACTIVE;
                return (
                  <tr key={u.id} className="border-b border-lineDark last:border-0">
                    <td className="px-5 py-3">
                      <Link href={`/app/users/${u.id}`} className="font-medium text-navy hover:text-gold-dim">
                        {u.name}
                      </Link>
                      <p className="text-xs text-navy/40">{u.email}</p>
                    </td>
                    <td className="px-5 py-3 text-navy/70">{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td className="px-5 py-3">
                      <StatusBadge label={status.label} tone={status.tone} />
                    </td>
                    <td className="px-5 py-3 text-navy/70">{u.clientAccess.length}</td>
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
