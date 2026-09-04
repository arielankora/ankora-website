import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app/AppShell";

export const metadata = { robots: { index: false, follow: false } };

async function loadCounts(canSeeClients: boolean, canSeeCategories: boolean, canSeeUsers: boolean) {
  const [clients, categories, users] = await Promise.all([
    canSeeClients ? prisma.client.count({ where: { deletedAt: null, status: "ACTIVE" } }) : null,
    canSeeCategories ? prisma.category.count({ where: { deletedAt: null, active: true } }) : null,
    canSeeUsers ? prisma.user.count({ where: { deletedAt: null, status: { not: "ARCHIVED" } } }) : null,
  ]);
  return { clients, categories, users };
}

export default async function AppHomePage() {
  const user = await requireUser();

  const canSeeClients = can(user.role, "client.manage");
  const canSeeCategories = can(user.role, "category.manage");
  const canSeeUsers = can(user.role, "user.manage");
  const canSeeAudit = can(user.role, "audit.view");

  const counts = await loadCounts(canSeeClients, canSeeCategories, canSeeUsers);

  const cards = [
    canSeeClients && { href: "/app/clients", label: "לקוחות פעילים", value: counts.clients },
    canSeeCategories && { href: "/app/categories", label: "קטגוריות פעילות", value: counts.categories },
    canSeeUsers && { href: "/app/users", label: "משתמשים", value: counts.users },
  ].filter(Boolean) as { href: string; label: string; value: number | null }[];

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-medium text-navy">שלום, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-navy/60">סקירה כללית של המערכת.</p>
        </div>

        {cards.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="rounded-2xl border border-lineDark bg-white p-6 transition-colors hover:border-gold"
              >
                <p className="text-3xl font-medium text-navy">{card.value}</p>
                <p className="mt-2 text-sm text-navy/60">{card.label}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-lineDark bg-white p-6 text-sm text-navy/60">
            אין עדיין נתונים להצגה עבור התפקיד שלך.
          </div>
        )}

        {canSeeAudit && (
          <Link
            href="/app/audit-log"
            className="inline-block text-sm text-gold-dim underline underline-offset-4"
          >
            צפייה ביומן הפעולות
          </Link>
        )}
      </div>
    </AppShell>
  );
}
