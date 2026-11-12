import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import type { User } from "@prisma/client";
import { can } from "@/lib/app-auth/permissions";
import { BottomNav } from "./BottomNav";
import { getTranslations } from "next-intl/server";
import { Sidebar } from "./Sidebar";
import { ACCOUNT_GROUP, type NavGroupId, type NavItem } from "./nav-groups";
import { TopBar } from "./TopBar";
import { BackSlotProvider } from "./BackSlot";
import { HashScroll } from "./HashScroll";
import { CommandPalette } from "./CommandPalette";
import { ActiveTimerProvider, MobileTimerStrip } from "./ActiveTimerProvider";
import { OfflineBanner } from "./states/Offline";
import { NotificationsBell, type NotificationSummary } from "./NotificationsBell";

type Translate = Awaited<ReturnType<typeof getTranslations<"shell">>>;

function navItemsFor(role: User["role"], t: Translate, options: { whatsappPoc?: boolean } = {}): NavItem[] {
  // 19.10.2026 (canvas "Ankora App UI Round", task cmvddvqqv000plc08l6qzt2ho):
  // four groups instead of six, by what the person came to do, and the
  // account items moved out of the list into the menu under the person's
  // name (Sidebar.tsx renders group ACCOUNT_GROUP there, not in the list).
  // A super admin went from 20 rows to 15, an operations manager from 10
  // to 6, a client from 9 to 5. "My time" is a tab of the timer,
  // scheduled reports a tab of the reports, the monthly report a view of
  // the portal's hours; their old addresses redirect.
  //
  // The portal keeps a separate, deliberately short list (spec 13: "feel
  // part of Ankora, not an internal tool exposed outward"), never derived
  // from the staff list below.
  //
  // Every item is still filtered server-side from the real permission
  // map; the pages re-check on their own.
  //
  // ADR 0006: a group is an id, and its label comes from the dictionary
  // beside the item's own. Sidebar.tsx and TopBar.tsx decide by the id,
  // so a translation can never move an item between the list and the menu.
  const item = (href: string, key: Parameters<Translate>[0], group?: NavGroupId): NavItem =>
    group ? { href, label: t(key), group, groupLabel: t(`groups.${group}`) } : { href, label: t(key) };

  if (role === "CLIENT_USER") {
    return [
      item("/app/portal", "nav.portalHome"),
      item("/app/portal/decisions", "nav.portalDecisions"),
      item("/app/portal/activity", "nav.portalActivity"),
      item("/app/portal/hours", "nav.portalHours"),
      item("/app/portal/history", "nav.portalHistory"),
      // 20.10.2026: the portal's own tab bar is gone; the menu is its one
      // navigation, so the client file joins it.
      item("/app/portal/file", "nav.portalFile"),
      ...accountItems(item),
    ];
  }

  const tracks = can(role, "time_entry.create_self");
  const items: NavItem[] = [item("/app", "nav.home", "work")];
  if (tracks) items.push(item("/app/timer", "nav.timer", "work"));
  if (tracks) items.push(item("/app/tasks", "nav.tasks", "work"));
  if (tracks) items.push(item("/app/calendar", "nav.calendar", "work"));
  // 20.10.2026: every approval in one place, with what waits on this
  // person beside it. Always there, unlike the old pending-approval
  // entry before it, so the way to it does not move while the count is zero.
  if (tracks) items.push(item("/app/approvals", "nav.approvals", "work"));

  if (can(role, "client.manage")) items.push(item("/app/clients", "nav.clients", "clients"));
  if (tracks) items.push(item("/app/important-dates", "nav.importantDates", "clients"));
  if (can(role, "credential.view")) items.push(item("/app/credentials", "nav.credentials", "clients"));
  // Communications (1.11.2026): only for those the screen opens to
  // (lib/comms/access.ts), the same rule the screens check. Anyone
  // else neither sees the link nor gets past the screen's own gate.
  if (options.whatsappPoc) items.push(item("/app/whatsapp-poc", "nav.comms", "clients"));

  if (can(role, "time_entry.edit_others")) items.push(item("/app/time-entries", "nav.timeEntries", "control"));
  if (can(role, "hour_bank.manage")) items.push(item("/app/hour-banks", "nav.hourBanks", "control"));
  if (can(role, "report.internal.view")) items.push(item("/app/reports", "nav.reports", "control"));
  // "Alert rules", not "alerts": the rules managers set, never confused
  // with "my notifications" in the account menu.
  if (can(role, "alert.manage")) items.push(item("/app/alerts", "nav.alertRules", "control"));

  if (can(role, "category.manage")) items.push(item("/app/categories", "nav.categories", "settings"));
  if (can(role, "user.manage")) items.push(item("/app/users", "nav.users", "settings"));
  if (can(role, "integration.manage")) items.push(item("/app/integrations", "nav.integrations", "settings"));
  if (can(role, "audit.view")) items.push(item("/app/audit-log", "nav.auditLog", "settings"));

  items.push(...accountItems(item));
  return items;
}

/// Self-service for every signed-in role. Last in the list, so the phone's
/// bottom bar keeps them under "more" and the palette still finds them.
function accountItems(item: (href: string, key: Parameters<Translate>[0], group?: NavGroupId) => NavItem): NavItem[] {
  return [
    item("/app/notifications", "nav.myNotifications", ACCOUNT_GROUP),
    item("/app/profile", "nav.myProfile", ACCOUNT_GROUP),
    item("/app/guide", "nav.guide", ACCOUNT_GROUP),
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
export async function AppShell({
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
  const t = await getTranslations("shell");
  const items = navItemsFor(user.role, t, { whatsappPoc: showComms ?? false });
  const roleLabel = t(`roles.${user.role}`);
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
        roleLabel={roleLabel}
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

      <BottomNav items={items} userName={user.name} roleLabel={roleLabel} />
    </div>
    </BackSlotProvider>
    </ActiveTimerProvider>
  );
}
