import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getClient } from "@/lib/app-domain/clients";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { EditClientForm } from "./EditClientForm";

export const metadata = { robots: { index: false, follow: false } };

export default async function ClientDetailPage({ params }: { params: { clientId: string } }) {
  const user = await requireUser();

  if (!can(user.role, "client.manage")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const client = await getClient(params.clientId);
  if (!client) notFound();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Link href="/app/clients" className="text-xs text-navy/50 hover:text-gold-dim">
            ← חזרה לרשימת הלקוחות
          </Link>
          <h1 className="mt-2 text-xl font-medium text-navy">{client.name}</h1>
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <EditClientForm client={client} />
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-navy">קטגוריות ({client.categories.length})</h2>
          {client.categories.length === 0 ? (
            <p className="mt-2 text-sm text-navy/50">אין עדיין קטגוריות ייעודיות ללקוח זה.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {client.categories.map((cat) => (
                <li key={cat.id} className="text-sm text-navy/70">
                  {cat.name}
                  {!cat.active && <span className="ms-2 text-xs text-navy/40">(לא פעיל)</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-navy">משתמשים מוקצים ({client.employeeAccess.length})</h2>
          {client.employeeAccess.length === 0 ? (
            <p className="mt-2 text-sm text-navy/50">אין עדיין עובדים מוקצים ללקוח זה.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {client.employeeAccess.map((access) => (
                <li key={access.id} className="text-sm text-navy/70">
                  {access.user.name} <span className="text-xs text-navy/40">({access.user.email})</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-navy/40">
            הקצאת עובדים ללקוחות מתבצעת מעמוד{" "}
            <Link href="/app/users" className="underline">
              משתמשים
            </Link>
            .
          </p>
        </div>
      </div>
    </AppShell>
  );
}
