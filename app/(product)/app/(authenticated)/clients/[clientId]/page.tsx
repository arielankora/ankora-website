import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getClient } from "@/lib/app-domain/clients";
import { listImportantDates, IMPORTANT_DATE_STATUS_LABELS } from "@/lib/app-domain/important-dates";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EditClientForm } from "./EditClientForm";
import type { ImportantDateStatus } from "@prisma/client";

const STATUS_TONE: Record<ImportantDateStatus, "green" | "amber" | "gray" | "red"> = {
  ACTIVE: "green",
  NEEDS_ATTENTION: "red",
  IN_PROGRESS: "amber",
  HANDLED_CURRENT: "gray",
  PAUSED: "gray",
  ARCHIVED: "gray",
};

export const metadata = { robots: { index: false, follow: false } };

export default async function ClientDetailPage({ params }: { params: { clientId: string } }) {
  const user = await requireUser();

  if (!can(user.role, "client.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const client = await getClient(params.clientId);
  if (!client) notFound();

  // Phase 10 ("מועדים חשובים") client-detail "Dates" section - reuses
  // listImportantDates' own access scoping (this page is already gated on
  // client.manage, a superset of every role that can reach
  // listImportantDates, so the call always succeeds here).
  const clientDates = await listImportantDates(user, { clientId: client.id });

  return (
    <>
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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-navy">מועדים חשובים ({clientDates.length})</h2>
            <Link href={`/app/important-dates?clientId=${client.id}`} className="text-xs text-gold-dim underline underline-offset-4">
              לכל המועדים של הלקוח
            </Link>
          </div>
          {clientDates.length === 0 ? (
            <p className="mt-2 text-sm text-navy/50">אין עדיין מועדים חשובים ללקוח זה.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {clientDates.slice(0, 8).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link href={`/app/important-dates/${d.id}`} className="text-navy hover:text-gold-dim">
                    {d.title}
                  </Link>
                  <StatusBadge label={IMPORTANT_DATE_STATUS_LABELS[d.status]} tone={STATUS_TONE[d.status]} />
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
    </>
  );
}
