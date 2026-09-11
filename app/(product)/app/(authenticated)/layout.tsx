import type { ReactNode } from "react";
import { requireUser } from "@/lib/app-auth/session";
import { AppShell } from "@/components/app/AppShell";

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
export default async function AuthenticatedAppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
