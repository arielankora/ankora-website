import type { ReactNode } from "react";
import type { Notification, Client } from "@prisma/client";
import { requireUser } from "@/lib/app-auth/session";
import { AppShell } from "@/components/app/AppShell";
import { can } from "@/lib/app-auth/permissions";
import { getActiveTimer } from "@/lib/app-domain/time-entries";
import { listNotificationsForUser, unreadNotificationCount } from "@/lib/app-domain/notifications";
import { listUpcomingImportantDates } from "@/lib/app-domain/important-dates";
import { countOpenAlertEvents } from "@/lib/app-domain/alerts";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { supervisionCounts } from "@/lib/app-domain/tasks";

/// Redesign direction A, layout-flash fix: AppShell (Sidebar + BottomNav)
/// used to be rendered inside every single page.tsx under app/(product)/app,
/// so App Router had no stable element to keep mounted across a
/// navigation - it tore down and rebuilt the *entire* tree (chrome
/// included) on every click, and this segment's loading.tsx skeleton
/// (which intentionally has no chrome of its own, see that file) briefly
/// stood in for the whole page. The visible result: click a nav item, see
/// a plain white/skeleton page, then the sidebar "pops in" a moment
/// later once the new page's data finished loading.
///
/// Moving AppShell up into this route-group layout fixes it the way
/// Next.js's App Router is designed to be used: everything under this
/// (authenticated) group only ever swaps out {children} - the layout
/// itself, and therefore the Sidebar/BottomNav inside AppShell, stays
/// mounted the whole time. loading.tsx (unchanged, still in this same
/// folder) now only covers {children}, so navigating shows the sidebar
/// staying put and just the content area swapping to its skeleton.
///
/// This is a route *group* - "(authenticated)" - not a URL segment, so
/// every path is unchanged (/app, /app/clients, etc). login/,
/// forgot-password/ and reset-password/ deliberately live as siblings
/// outside this group: they must render without a session, and this
/// layout's requireUser() would otherwise redirect a logged-out visitor
/// straight back into a loop on those exact pages.
/// App redesign (design_handoff_ankora_app_redesign/README.md, App Shell +
/// "State Management" sections): the AppShell now needs the caller's own
/// active timer, notifications and a few nav counters on *every* screen
/// (top bar live-timer pill, bell, sidebar counters, command palette) - not
/// just the screens that already fetched some of this themselves (Timer,
/// Notifications). Fetched once here, alongside requireUser(), so
/// individual page.tsx files don't each need to know about the shell's
/// data needs. Every call below is either already used elsewhere in the
/// app (getActiveTimer, listNotificationsForUser, countOpenAlertEvents,
/// listUpcomingImportantDates, listAccessibleClients) or a thin read on
/// top of one - no new domain logic was added for this.
export default async function AuthenticatedAppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  const canTrackTime = can(user.role, "time_entry.create_self");
  const canSeeAlerts = can(user.role, "alert.manage");
  const isClientUser = user.role === "CLIENT_USER";

  const [
    activeTimerRow,
    notificationRows,
    unreadCount,
    importantDates,
    alertsCount,
    accessibleClients,
    supervising,
  ] = await Promise.all([
      canTrackTime ? getActiveTimer(user.id) : Promise.resolve(null),
      listNotificationsForUser(user.id),
      unreadNotificationCount(user.id),
      // Reused only for its length as a nav counter - listUpcomingImportantDates
      // is already the vetted, access-scoped query the Important Dates screen
      // itself uses (see that screen's page.tsx), so this doesn't duplicate
      // any access logic.
      canTrackTime ? listUpcomingImportantDates(user, 20) : Promise.resolve([]),
      canSeeAlerts ? countOpenAlertEvents() : Promise.resolve(0),
      // Command palette's "לקוחות" group. Skipped for CLIENT_USER: the
      // portal nav has no /app/clients route, and listAccessibleClients'
      // own-access branch isn't meant to resolve "which client is this
      // portal user" (that's resolvePortalClient, a different lookup).
      isClientUser ? Promise.resolve([]) : listAccessibleClients(user),
      // Tasks phase 2. One grouped count, and it decides two things: the
      // nav row exists only for people who supervise open work, and the
      // number beside it is what is waiting on them right now. Cheap
      // enough to run on every page because a person who supervises
      // nothing still only pays for one count.
      canTrackTime ? supervisionCounts(user) : Promise.resolve({ total: 0, pending: 0 }),
    ]);

  return (
    <AppShell
      user={user}
      activeTimer={activeTimerRow ? { startAt: activeTimerRow.startAt.toISOString() } : null}
      notifications={notificationRows.map((n: Notification) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt ? n.readAt.toISOString() : null,
      }))}
      unreadCount={unreadCount}
      importantDatesCount={importantDates.length}
      alertsCount={alertsCount}
      supervising={supervising}
      clients={accessibleClients.map((c: Client) => ({ id: c.id, name: c.name }))}
    >
      {children}
    </AppShell>
  );
}
