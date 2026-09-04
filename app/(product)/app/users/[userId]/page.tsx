import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/app-domain/clients";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { EditRoleStatusForm } from "./EditRoleStatusForm";
import { ClientAccessForm } from "./ClientAccessForm";
import { logoutAllSessionsAction } from "../actions";

export const metadata = { robots: { index: false, follow: false } };

export default async function UserDetailPage({ params }: { params: { userId: string } }) {
  const user = await requireUser();

  if (!can(user.role, "user.manage")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const [targetUser, clients] = await Promise.all([
    prisma.user.findFirst({
      where: { id: params.userId, deletedAt: null },
      include: { clientAccess: true },
    }),
    listClients(),
  ]);
  if (!targetUser) notFound();

  const isSelf = targetUser.id === user.id;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Link href="/app/users" className="text-xs text-navy/50 hover:text-gold-dim">
            ← חזרה לרשימת המשתמשים
          </Link>
          <h1 className="mt-2 text-xl font-medium text-navy">{targetUser.name}</h1>
          <p className="mt-1 text-sm text-navy/60">{targetUser.email}</p>
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-navy">תפקיד וסטטוס</h2>
          <EditRoleStatusForm targetUser={targetUser} isSelf={isSelf} />
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-navy">גישה ללקוחות</h2>
          <ClientAccessForm
            userId={targetUser.id}
            clients={clients.filter((c) => c.status === "ACTIVE").map((c) => ({ id: c.id, name: c.name }))}
            assignedClientIds={targetUser.clientAccess.map((a) => a.clientId)}
          />
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-navy">אבטחה</h2>
          <p className="mt-1 text-sm text-navy/60">
            ניתוק כל ההתחברויות הפעילות של המשתמש. שימושי אם יש חשד שהחשבון נפגע.
          </p>
          <form action={logoutAllSessionsAction} className="mt-3">
            <input type="hidden" name="userId" value={targetUser.id} />
            <button
              type="submit"
              className="rounded-full border border-lineDark px-4 py-2 text-xs font-medium text-navy/70 hover:border-gold hover:text-navy"
            >
              ניתוק כל ההתחברויות
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
