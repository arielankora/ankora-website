import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import type { User } from "@prisma/client";
import { can } from "@/lib/app-auth/permissions";
import { BottomNav } from "./BottomNav";
import { ACCOUNT_GROUP, Sidebar, type NavItem } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BackSlotProvider } from "./BackSlot";
import { HashScroll } from "./HashScroll";
import { CommandPalette } from "./CommandPalette";
import { ActiveTimerProvider, MobileTimerStrip } from "./ActiveTimerProvider";
import { OfflineBanner } from "./states/Offline";
import { NotificationsBell, type NotificationSummary } from "./NotificationsBell";

const ROLE_LABELS: Record<User["role"], string> = {
  SUPER_ADMIN: "מנהל-על",
  ANKORA_ADMIN: "מנהל Ankora",
  ANKORA_EMPLOYEE: "ספק פנימי אנקורה",
  CLIENT_USER: "לקוח",
};

function navItemsFor(role: User["role"], options: { whatsappPoc?: boolean } = {}): NavItem[] {
  // 19.10.2026 (canvas "Ankora App UI Round", task cmvddvqqv000plc08l6qzt2ho):
  // four groups instead of six, by what the person came to do, and the
  // account items moved out of the list into the menu under the person's
  // name (Sidebar.tsx renders group ACCOUNT_GROUP there, not in the list).
  // A super admin went from 20 rows to 15, an operations manager from 10
  // to 6, a client from 9 to 5. "הזמן שלי" is a tab of the timer,
  // "דוחות מתוזמנים" a tab of the reports, "דוח חודשי" a view of the
  // portal's hours; their old addresses redirect.
  //
  // The portal keeps a separate, deliberately short list (spec 13: "feel
  // part of Ankora, not an internal tool exposed outward"), never derived
  // from the staff list below.
  //
  // Every item is still filtered server-side from the real permission
  // map; the pages re-check on their own.
  if (role === "CLIENT_USER") {
    return [
      { href: "/app/portal", label: "בית" },
      { href: "/app/portal/decisions", label: "החלטות" },
      { href: "/app/portal/activity", label: "פעילות" },
      { href: "/app/portal/hours", label: "שעות ודוחות" },
      { href: "/app/portal/history", label: "היסטוריה" },
      // 20.10.2026: the portal's own tab bar is gone; the menu is its one
      // navigation, so the client file joins it.
      { href: "/app/portal/file", label: "התיק שלי" },
      ...accountItems(),
    ];
  }

  const tracks = can(role, "time_entry.create_self");
  const items: NavItem[] = [{ href: "/app", label: "בית", group: "עבודה" }];
  if (tracks) items.push({ href: "/app/timer", label: "טיימר", group: "עבודה" });
  if (tracks) items.push({ href: "/app/tasks", label: "משימות", group: "עבודה" });
  if (tracks) items.push({ href: "/app/calendar", label: "יומן", group: "עבודה" });
  // 20.10.2026: every approval in one place, with what waits on this
  // person beside it. Always there, unlike "ממתין לאישור" before it, so
  // the way to it does not move while the count is zero.
  if (tracks) items.push({ href: "/app/approvals", label: "אישורים", group: "עבודה" });

  if (can(role, "client.manage")) items.push({ href: "/app/clients", label: "לקוחות", group: "לקוחות" });
  if (tracks) items.push({ href: "/app/important-dates", label: "מועדים חשובים", group: "לקוחות" });
  if (can(role, "credential.view")) items.push({ href: "/app/credentials", label: "מערכות וגישות", group: "לקוחות" });
  // Communications (1.11.2026): only for those the screen opens to
  // (lib/comms/access.ts), the same rule the screens check. Anyone
  // else neither sees the link nor gets past the screen's own gate.
  if (options.whatsappPoc) items.push({ href: "/app/whatsapp-poc", label: "תקשורת", group: "לקוחות" });

  if (can(role, "time_entry.edit_others")) items.push({ href: "/app/time-entries", label: "דיווחי זמן", group: "בקרה" });
  if (can(role, "hour_bank.manage")) items.push({ href: "/app/hour-banks", label: "בנק שעות", group: "בקרה" });
  if (can(role, "report.internal.view")) items.push({ href: "/app/reports", label: "דוחות", group: "בקרה" });
  // "כללי התראה", not "התראות": the rules managers set, never confused with
  // "התראות שלי" in the account menu.
  if (can(role, "alert.manage")) items.push({ href: "/app/alerts", label: "כללי התראה", group: "בקרה" });

  if (can(role, "category.manage")) items.push({ href: "/app/categories", label: "קטגוריות", group: "הגדרות" });
  if (can(role, "user.manage")) items.push({ href: "/app/users", label: "משתמשים", group: "הגדרות" });
  if (can(role, "integration.manage")) items.push({ href: "/app/integrations", label: "אינטגרציות", group: "הגדרות" });
  if (can(role, "audit.view")) items.push({ href: "/app/audit-log", label: "יומן פעולות", group: "הגדרות" });

  items.push(...accountItems());
  return items;
}

/// Self-service for every signed-in role. Last in the list, so the phone's
/// bottom bar keeps them under "עוד" and the palette still finds them.
function accountItems(): NavItem[] {
  return [
    { href: "/app/notifications", label: "התראות שלי", group: ACCOUNT_GROUP },
    { href: "/app/profile", label: "הפרופיל שלי", group: ACCOUNT_GROUP },
    { href: "/app/guide", label: "מדריך שימוש", group: ACCOUNT_GROUP },
  ];
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
  supervising,
  approvals = 0,
  clients,
  showComms,
  children,
}: {
  user: User;
  activeTimer: { startAt: string; extraCount?: number } | null;
  notifications: NotificationSummary[];
  unreadCount: number;
  importantDatesCount: number;
  alertsCount: number;
  /// Tasks phase 2. `pending`, the tasks waiting on this person's
  /// sign-off, is printed beside "משימות".
  supervising: { total: number; pending: number };
  /// Everything waiting on this person's approval (lib/approvals.ts).
  approvals?: number;
  clients: { id: string; name: string }[];
  /// The communications screen, for those it opens to (lib/comms/access.ts).
  showComms?: boolean;
  children: ReactNode;
}) {
  const items = navItemsFor(user.role, { whatsappPoc: showComms ?? false });
  const showPrimaryCta = can(user.role, "time_entry.create_self");

  return (
    <ActiveTimerProvider
      initial={activeTimer ? { startAt: activeTimer.startAt, extraCount: activeTimer.extraCount ?? 0 } : null}
    >
    <BackSlotProvider>
    <div className="min-h-screen bg-app-surface-page md:flex">
      <Sidebar
        items={items}
        userName={user.name}
        roleLabel={ROLE_LABELS[user.role]}
        counters={{
          importantDatesCount,
          alertsCount,
          supervisingCount: supervising.pending,
          approvalsCount: approvals,
        }}
      />
      <CommandPalette actions={items.map((i) => ({ href: i.href, label: i.label }))} clients={clients} />

      <div className="min-w-0 flex-1">
        <header className="border-b border-app-border bg-white pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <Link href="/app" className="-my-2.5 py-2.5 text-sm font-semibold uppercase tracking-[0.16em] text-app-text-accent">
              Ankora
            </Link>
            <NotificationsBell notifications={notifications} unreadCount={unreadCount} />
          </div>
          {/* Spec, Responsive/Mobile: "פס טיימר חי מתחת לכותרת בכל מסך (לחיצה → טיימר)". */}
          <MobileTimerStrip />
        </header>

        <TopBar
          items={items}
          notifications={notifications}
          unreadCount={unreadCount}
          showPrimaryCta={showPrimaryCta}
        />

        {/* 16px sides on a phone, 28px from md. At 28px a 360px phone kept
            304px for content, and the tasks list (26.9.2026) was one of
            several screens that ran out of room because of it. The bottom
            padding clears the fixed BottomNav, which grows by the home
            indicator's inset, so the padding grows by it too. */}
        <main className="mx-auto max-w-appContent space-y-4 px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-7 md:py-7 md:pb-7">
          <OfflineBanner />
          <Suspense fallback={null}>
            <HashScroll />
          </Suspense>
          {children}
        </main>
      </div>

      <BottomNav items={items} userName={user.name} roleLabel={ROLE_LABELS[user.role]} />
    </div>
    </BackSlotProvider>
    </ActiveTimerProvider>
  );
}
