"use client";
import { usePathname } from "next/navigation";
import type { NavItem } from "./Sidebar";

/// 3.11.2026 (Hadas's review): "גם את החלק העליון הלקוח רואה?". A client
/// never did: "דיווח חדש", "משימה חדשה" and the staff menu need time
/// tracking, which CLIENT_USER does not hold (AppShell.tsx, permissions.ts).
/// What Hadas saw was a manager's preview of the portal, which kept the
/// manager's own shell around the client's screens, and so did not show
/// "בדיוק מה שהלקוח רואה" as its banner promises.
///
/// While a preview is on (`portalItems` is passed) and the page is a portal
/// screen, the shell uses the client's menu and hides the staff actions.
/// Anywhere else in the app the manager's own shell is back, so a preview
/// left running never hides the team's tools from the team.
export function useShellNav(items: NavItem[], portalItems?: NavItem[]) {
  const pathname = usePathname() ?? "";
  const inPortalPreview =
    !!portalItems && (pathname === "/app/portal" || pathname.startsWith("/app/portal/"));
  return { items: inPortalPreview ? portalItems : items, inPortalPreview };
}
