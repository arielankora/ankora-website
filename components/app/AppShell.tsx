import type { ReactNode } from "react";
import Link from "next/link";
import type { User } from "@prisma/client";
import { can } from "@/lib/app-auth/permissions";
import { LogoutButton } from "./LogoutButton";
import { MobileNav } from "./MobileNav";

const ROLE_LABELS: Record<User["role"], string> = {
  SUPER_ADMIN: "מנהל-על",
  ANKORA_ADMIN: "מנהל Ankora",
  ANKORA_EMPLOYEE: "עובד Ankora",
  CLIENT_USER: "לקוח",
};

function navItemsFor(role: User["role"]) {
  const items: { href: string; label: string }[] = [{ href: "/app", label: "בית" }];
  if (can(role, "client.manage")) items.push({ href: "/app/clients", label: "לקוחות" });
  if (can(role, "category.manage")) items.push({ href: "/app/categories", label: "קטגוריות" });
  if (can(role, "user.manage")) items.push({ href: "/app/users", label: "משתמשים" });
  if (can(role, "audit.view")) items.push({ href: "/app/audit-log", label: "יומן פעולות" });
  return items;
}

/// Shared authenticated shell for every screen under app/(product)/app/**
/// (except the auth pages themselves). Spec 4.1's role-based nav: links are
/// filtered server-side from the real permission map - see permissions.ts -
/// not just visually hidden, since the corresponding pages/actions also
/// re-check permissions independently.
export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const items = navItemsFor(user.role);

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-lineDark bg-white">
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-8">
            <Link href="/app" className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-dim">
              Ankora
            </Link>
            <nav className="hidden items-center gap-6 md:flex">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-navy/70 transition-colors hover:text-navy"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="hidden items-center gap-4 md:flex">
            <div className="text-end leading-tight">
              <p className="text-sm font-medium text-navy">{user.name}</p>
              <p className="text-xs text-navy/50">{ROLE_LABELS[user.role]}</p>
            </div>
            <LogoutButton />
          </div>

          <MobileNav items={items} userName={user.name} roleLabel={ROLE_LABELS[user.role]} />
        </div>
      </header>

      <main className="mx-auto max-w-content px-6 py-8 md:py-10">{children}</main>
    </div>
  );
}
