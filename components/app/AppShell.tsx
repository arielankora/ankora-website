import type { ReactNode } from "react";
import Link from "next/link";
import type { User } from "@prisma/client";
import { can } from "@/lib/app-auth/permissions";
import { LogoutButton } from "./LogoutButton";
import { BottomNav } from "./BottomNav";

const ROLE_LABELS: Record<User["role"], string> = {
  SUPER_ADMIN: "מנהל-על",
  ANKORA_ADMIN: "מנהל Ankora",
  ANKORA_EMPLOYEE: "עובד Ankora",
  CLIENT_USER: "לקוח",
};

function navItemsFor(role: User["role"]) {
  // Phase 6 (spec 13 "Client Portal"): a CLIENT_USER gets an entirely
  // separate, deliberately short nav - the portal is meant to "feel part
  // of Ankora, not an internal tool exposed outward" (spec 13's own
  // words), so it never shows any of the Ankora-internal admin screens
  // below, even ones a permission check would technically pass (there are
  // none for CLIENT_USER today, but this keeps the two navs structurally
  // separate rather than relying on every future admin item remembering
  // to gate itself out for this role).
  if (role === "CLIENT_USER") {
    return [
      { href: "/app/portal", label: "לוח בקרה" },
      { href: "/app/portal/weekly", label: "פעילות שבועית" },
      { href: "/app/portal/monthly", label: "דוח חודשי" },
      { href: "/app/portal/history", label: "היסטוריה" },
      { href: "/app/notifications", label: "התראות שלי" },
      { href: "/app/profile", label: "הפרופיל שלי" },
      { href: "/app/guide", label: "מדריך שימוש" },
    ];
  }

  const items: { href: string; label: string }[] = [{ href: "/app", label: "בית" }];
  // Phase 2 (spec 11 "מסכים - חוויית עובד Ankora"): Today/Timer and My
  // Time come first in the nav for anyone who can track their own time -
  // spec 6.2 calls Quick Timer "המסך החשוב ביותר" on mobile.
  if (can(role, "time_entry.create_self")) items.push({ href: "/app/timer", label: "טיימר" });
  if (can(role, "time_entry.create_self")) items.push({ href: "/app/my-time", label: "הזמן שלי" });
  // Phase 9 gap-fix (spec 11, docs/adr/0001 section 17.2): standalone
  // Tasks screen - same gate as Timer/My Time (see lib/app-domain/tasks.ts
  // for why no dedicated permission exists).
  if (can(role, "time_entry.create_self")) items.push({ href: "/app/tasks", label: "משימות" });
  if (can(role, "client.manage")) items.push({ href: "/app/clients", label: "לקוחות" });
  if (can(role, "category.manage")) items.push({ href: "/app/categories", label: "קטגוריות" });
  // Spec 12: Admin "Time Entries" screen - cross-client table, gated on
  // the same permission that lets an admin edit someone else's entries.
  if (can(role, "time_entry.edit_others")) items.push({ href: "/app/time-entries", label: "דיווחי זמן" });
  if (can(role, "user.manage")) items.push({ href: "/app/users", label: "משתמשים" });
  // Phase 3 (spec 12): Hour Banks admin screen - billing policy + cycles
  // + adjustments + live utilization, gated on the same Super-Admin-only
  // permission as the domain logic itself.
  if (can(role, "hour_bank.manage")) items.push({ href: "/app/hour-banks", label: "בנק שעות" });
  if (can(role, "alert.manage")) items.push({ href: "/app/alerts", label: "התראות" });
  // Phase 5 (spec 12): Reports admin screen - internal dashboards +
  // reports + exports, gated on report.internal.view (SUPER_ADMIN +
  // ANKORA_ADMIN, unlike hour_bank.manage/alert.manage - see permissions.ts).
  if (can(role, "report.internal.view")) items.push({ href: "/app/reports", label: "דוחות" });
  // Phase 6 (spec 12/15): Report Schedules admin screen - bundled with the
  // same permission as Reports itself (see permissions.ts's Phase 6
  // comment on report.internal.view vs report.client.view).
  if (can(role, "report.internal.view")) items.push({ href: "/app/report-schedules", label: "דוחות מתוזמנים" });
  if (can(role, "audit.view")) items.push({ href: "/app/audit-log", label: "יומן פעולות" });
  // Phase 8 (spec 12/17.3): Integrations admin screen - placeholder card
  // only (no real provider connected yet), SUPER_ADMIN-only per
  // permissions.ts's integration.manage comment. Listed last, matching
  // spec 12's own admin-screens table order (Integrations is its final row).
  if (can(role, "integration.manage")) items.push({ href: "/app/integrations", label: "אינטגרציות" });
  // Phase 9 gap-fix: Notifications + Profile are self-service for every
  // logged-in role (see permissions.ts's Phase 9 comment) - listed last,
  // right before the guide, for both the CLIENT_USER nav above and this
  // internal-staff nav.
  items.push({ href: "/app/notifications", label: "התראות שלי" });
  items.push({ href: "/app/profile", label: "הפרופיל שלי" });
  // Documentation, not a permission - every logged-in role should be able
  // to understand the system in their own language.
  items.push({ href: "/app/guide", label: "מדריך שימוש" });
  return items;
}

/// Shared authenticated shell for every screen under app/(product)/app/**
/// (except the auth pages themselves). Spec 4.1's role-based nav: links are
/// filtered server-side from the real permission map - see permissions.ts -
/// not just visually hidden, since the corresponding pages/actions also
/// re-check permissions independently.
///
/// Phase 7 (spec 11.1, ADR addendum 14.5): the mobile nav is now a fixed
/// bottom tab bar (BottomNav) instead of a header hamburger dropdown - the
/// header itself only shows the desktop inline nav at md+ widths. <main>
/// gets bottom padding at mobile widths so content never sits behind the
/// fixed bar.
export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const items = navItemsFor(user.role);

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-lineDark bg-white">
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-6 py-4">
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

          <div className="hidden items-center gap-4 md:flex">
            <div className="text-end leading-tight">
              <p className="text-sm font-medium text-navy">{user.name}</p>
              <p className="text-xs text-navy/50">{ROLE_LABELS[user.role]}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-content px-6 py-8 pb-24 md:py-10 md:pb-10">{children}</main>

      <BottomNav items={items} userName={user.name} roleLabel={ROLE_LABELS[user.role]} />
    </div>
  );
}
