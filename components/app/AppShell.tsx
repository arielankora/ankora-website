import type { ReactNode } from "react";
import Link from "next/link";
import type { User } from "@prisma/client";
import { can } from "@/lib/app-auth/permissions";
import { BottomNav } from "./BottomNav";
import { Sidebar, type NavItem } from "./Sidebar";

const ROLE_LABELS: Record<User["role"], string> = {
  SUPER_ADMIN: "מנהל-על",
  ANKORA_ADMIN: "מנהל Ankora",
  ANKORA_EMPLOYEE: "עובד Ankora",
  CLIENT_USER: "לקוח",
};

function navItemsFor(role: User["role"]): NavItem[] {
  // Phase 6 (spec 13 "Client Portal"): a CLIENT_USER gets an entirely
  // separate, deliberately short nav - the portal is meant to "feel part
  // of Ankora, not an internal tool exposed outward" (spec 13's own
  // words), so it never shows any of the Ankora-internal admin screens
  // below, even ones a permission check would technically pass (there are
  // none for CLIENT_USER today, but this keeps the two navs structurally
  // separate rather than relying on every future admin item remembering
  // to gate itself out for this role).
  //
  // `group` (redesign direction A): section header rendered by Sidebar.tsx
  // the first time it changes as items are walked in order - purely a
  // presentation grouping, no effect on BottomNav or the permission gates
  // below.
  if (role === "CLIENT_USER") {
    return [
      { href: "/app/portal", label: "לוח בקרה", group: "פורטל" },
      { href: "/app/portal/weekly", label: "פעילות שבועית", group: "פורטל" },
      { href: "/app/portal/monthly", label: "דוח חודשי", group: "פורטל" },
      { href: "/app/portal/history", label: "היסטוריה", group: "פורטל" },
      { href: "/app/notifications", label: "התראות שלי", group: "חשבון" },
      { href: "/app/profile", label: "הפרופיל שלי", group: "חשבון" },
      { href: "/app/guide", label: "מדריך שימוש", group: "חשבון" },
    ];
  }

  const items: NavItem[] = [{ href: "/app", label: "בית", group: "בית" }];
  // Phase 2 (spec 11 "מסכים - חוויית עובד Ankora"): Today/Timer and My
  // Time come first in the nav for anyone who can track their own time -
  // spec 6.2 calls Quick Timer "המסך החשוב ביותר" on mobile.
  if (can(role, "time_entry.create_self")) items.push({ href: "/app/timer", label: "טיימר", group: "העבודה שלי" });
  if (can(role, "time_entry.create_self")) items.push({ href: "/app/my-time", label: "הזמן שלי", group: "העבודה שלי" });
  // Phase 9 gap-fix (spec 11, docs/adr/0001 section 17.2): standalone
  // Tasks screen - same gate as Timer/My Time (see lib/app-domain/tasks.ts
  // for why no dedicated permission exists).
  if (can(role, "time_entry.create_self")) items.push({ href: "/app/tasks", label: "משימות", group: "העבודה שלי" });
  if (can(role, "client.manage")) items.push({ href: "/app/clients", label: "לקוחות", group: "ניהול" });
  if (can(role, "category.manage")) items.push({ href: "/app/categories", label: "קטגוריות", group: "ניהול" });
  if (can(role, "user.manage")) items.push({ href: "/app/users", label: "משתמשים", group: "ניהול" });
  // Spec 12: Admin "Time Entries" screen - cross-client table, gated on
  // the same permission that lets an admin edit someone else's entries.
  if (can(role, "time_entry.edit_others")) items.push({ href: "/app/time-entries", label: "דיווחי זמן", group: "דיווח ובקרה" });
  // Phase 3 (spec 12): Hour Banks admin screen - billing policy + cycles
  // + adjustments + live utilization, gated on the same Super-Admin-only
  // permission as the domain logic itself.
  if (can(role, "hour_bank.manage")) items.push({ href: "/app/hour-banks", label: "בנק שעות", group: "דיווח ובקרה" });
  if (can(role, "alert.manage")) items.push({ href: "/app/alerts", label: "התראות", group: "דיווח ובקרה" });
  // Phase 5 (spec 12): Reports admin screen - internal dashboards +
  // reports + exports, gated on report.internal.view (SUPER_ADMIN +
  // ANKORA_ADMIN, unlike hour_bank.manage/alert.manage - see permissions.ts).
  if (can(role, "report.internal.view")) items.push({ href: "/app/reports", label: "דוחות", group: "דיווח ובקרה" });
  // Phase 6 (spec 12/15): Report Schedules admin screen - bundled with the
  // same permission as Reports itself (see permissions.ts's Phase 6
  // comment on report.internal.view vs report.client.view).
  if (can(role, "report.internal.view")) items.push({ href: "/app/report-schedules", label: "דוחות מתוזמנים", group: "דיווח ובקרה" });
  if (can(role, "audit.view")) items.push({ href: "/app/audit-log", label: "יומן פעולות", group: "דיווח ובקרה" });
  // Phase 8 (spec 12/17.3): Integrations admin screen - placeholder card
  // only (no real provider connected yet), SUPER_ADMIN-only per
  // permissions.ts's integration.manage comment. Listed last, matching
  // spec 12's own admin-screens table order (Integrations is its final row).
  if (can(role, "integration.manage")) items.push({ href: "/app/integrations", label: "אינטגרציות", group: "מערכת" });
  // Phase 9 gap-fix: Notifications + Profile are self-service for every
  // logged-in role (see permissions.ts's Phase 9 comment) - listed last,
  // right before the guide, for both the CLIENT_USER nav above and this
  // internal-staff nav.
  items.push({ href: "/app/notifications", label: "התראות שלי", group: "חשבון" });
  items.push({ href: "/app/profile", label: "הפרופיל שלי", group: "חשבון" });
  // Documentation, not a permission - every logged-in role should be able
  // to understand the system in their own language.
  items.push({ href: "/app/guide", label: "מדריך שימוש", group: "חשבון" });
  return items;
}

/// Shared authenticated shell for every screen under app/(product)/app/**
/// (except the auth pages themselves). Spec 4.1's role-based nav: links are
/// filtered server-side from the real permission map - see permissions.ts -
/// not just visually hidden, since the corresponding pages/actions also
/// re-check permissions independently.
///
/// Redesign direction A (approved by Ariel after a full-app UI audit; see
/// docs/adr/0001 addendum "App redesign - direction A"): the old single-row
/// header nav (16+ flat text links, no grouping) is replaced on desktop by
/// a grouped icon+label Sidebar. The header itself now only renders at
/// mobile widths (just the wordmark - identity/role/logout live in
/// BottomNav's "more" sheet, unchanged from Phase 7). <main> keeps its
/// bottom padding for the fixed bottom bar at mobile widths only.
export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const items = navItemsFor(user.role);

  return (
    <div className="min-h-screen bg-paper md:flex">
      <Sidebar items={items} userName={user.name} roleLabel={ROLE_LABELS[user.role]} />

      <div className="min-w-0 flex-1">
        <header className="border-b border-lineDark bg-white md:hidden">
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <Link href="/app" className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-dim">
              Ankora
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-content px-6 py-8 pb-24 md:py-10 md:pb-10">{children}</main>
      </div>

      <BottomNav items={items} userName={user.name} roleLabel={ROLE_LABELS[user.role]} />
    </div>
  );
}
