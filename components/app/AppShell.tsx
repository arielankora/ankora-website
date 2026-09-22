import type { ReactNode } from "react";
import Link from "next/link";
import type { User } from "@prisma/client";
import { can } from "@/lib/app-auth/permissions";
import { BottomNav } from "./BottomNav";
import { Sidebar, type NavItem } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { LiveTimerPill } from "./LiveTimerPill";
import { OfflineBanner } from "./states/Offline";
import { NotificationsBell, type NotificationSummary } from "./NotificationsBell";

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
      // Portal phase 1: the nav mirrors the tab bar, in the order of the
      // client's questions. "פעילות שבועית" is reachable from the שעות
      // screen rather than listed here - see PortalTabs's comment.
      { href: "/app/portal", label: "בית", group: "פורטל" },
      { href: "/app/portal/activity", label: "פעילות", group: "פורטל" },
      { href: "/app/portal/hours", label: "שעות", group: "פורטל" },
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
  // Phase 10 (spec: "מועדים חשובים" - Important Dates). Gated the exact
  // same way as Tasks (time_entry.create_self - see permissions.ts's
  // Phase 10 comment and lib/app-domain/important-dates.ts's own header
  // comment for why no dedicated permission exists): every role that
  // tracks time for a client should see and manage that client's
  // important dates, including ANKORA_EMPLOYEE. Placed in the "ניהול"
  // group per the brief's explicit nav-placement instruction, even though
  // its permission gate matches the "העבודה שלי" items above it.
  if (can(role, "time_entry.create_self")) items.push({ href: "/app/important-dates", label: "מועדים חשובים", group: "ניהול" });
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
/// docs/adr/0001 addendum "App redesign - direction A") built the grouped
/// icon+label Sidebar and the mobile-only wordmark header. The high-fidelity
/// app redesign (design_handoff_ankora_app_redesign/README.md) layered onto
/// that: a desktop TopBar (breadcrumb/title, live timer pill, notification
/// bell, primary CTA), a ⌘K command palette, a mobile live-timer strip under
/// the wordmark header, and an offline banner - all data (activeTimer,
/// notifications, counters, clients) is fetched once in
/// (authenticated)/layout.tsx and threaded through here rather than
/// re-fetched per screen.
export function AppShell({
  user,
  activeTimer,
  notifications,
  unreadCount,
  importantDatesCount,
  alertsCount,
  clients,
  children,
}: {
  user: User;
  activeTimer: { startAt: string } | null;
  notifications: NotificationSummary[];
  unreadCount: number;
  importantDatesCount: number;
  alertsCount: number;
  clients: { id: string; name: string }[];
  children: ReactNode;
}) {
  const items = navItemsFor(user.role);
  const showPrimaryCta = can(user.role, "time_entry.create_self");

  return (
    <div className="min-h-screen bg-cream md:flex">
      <Sidebar
        items={items}
        userName={user.name}
        roleLabel={ROLE_LABELS[user.role]}
        counters={{ activeTimerStartAt: activeTimer?.startAt ?? null, importantDatesCount, alertsCount }}
      />
      <CommandPalette actions={items.map((i) => ({ href: i.href, label: i.label }))} clients={clients} />

      <div className="min-w-0 flex-1">
        <header className="border-b border-lineDark bg-white md:hidden">
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <Link href="/app" className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-dim">
              Ankora
            </Link>
            <NotificationsBell notifications={notifications} unreadCount={unreadCount} />
          </div>
          {/* Spec, Responsive/Mobile: "פס טיימר חי מתחת לכותרת בכל מסך (לחיצה → טיימר)". */}
          {activeTimer && (
            <div className="border-t border-lineDark px-6 py-2">
              <LiveTimerPill startAt={activeTimer.startAt} />
            </div>
          )}
        </header>

        <TopBar
          items={items}
          activeTimer={activeTimer}
          notifications={notifications}
          unreadCount={unreadCount}
          showPrimaryCta={showPrimaryCta}
        />

        <main className="mx-auto max-w-appContent space-y-4 px-7 py-7 pb-24 md:pb-7">
          <OfflineBanner />
          {children}
        </main>
      </div>

      <BottomNav items={items} userName={user.name} roleLabel={ROLE_LABELS[user.role]} />
    </div>
  );
}
