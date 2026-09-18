"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import type { NavItem } from "./Sidebar";
import { LiveTimerPill } from "./LiveTimerPill";
import { NotificationsBell, type NotificationSummary } from "./NotificationsBell";

// App redesign (handoff README, App Shell section): "סרגל עליון:
// position:sticky, backdrop-filter:blur(8px), רקע rgba(255,255,255,.92),
// ריפוד 11px 28px, min-height:62px, flex-wrap:wrap." Desktop-only (md+) -
// the existing mobile-only wordmark header in AppShell.tsx is untouched,
// this renders alongside it and is hidden below md.
//
// DOM order is [actions cluster, breadcrumb+title]: spec puts the
// timer/bell/CTA cluster on the physical right and the breadcrumb/title on
// the physical left. In this app's RTL layout the inline-start edge is the
// right, so the first flex child (not row-reversed) lands there - the
// second child lands at the left/end edge. See inline comments below.
export function TopBar({
  items,
  activeTimer,
  notifications,
  unreadCount,
  showPrimaryCta,
}: {
  items: NavItem[];
  activeTimer: { startAt: string } | null;
  notifications: NotificationSummary[];
  unreadCount: number;
  showPrimaryCta: boolean;
}) {
  const pathname = usePathname();
  const current = [...items].reverse().find((item) => (item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href)));

  return (
    <header className="sticky top-0 z-30 hidden min-h-[62px] flex-wrap items-center justify-between gap-4 border-b border-lineDark bg-white/92 px-7 py-[11px] backdrop-blur-[8px] md:flex">
      {/* Right (start) side: live timer pill, notification bell, primary CTA. */}
      <div className="flex items-center gap-3">
        {activeTimer && <LiveTimerPill startAt={activeTimer.startAt} />}
        <NotificationsBell notifications={notifications} unreadCount={unreadCount} />
        {showPrimaryCta && (
          <Link
            href="/app/my-time"
            className="flex items-center gap-1.5 rounded-full bg-gold-gradient px-4 py-2 text-[13px] font-medium text-ink"
          >
            <Plus size={15} strokeWidth={2.25} />
            דיווח חדש
          </Link>
        )}
      </div>

      {/* Left (end) side: breadcrumb + screen title. */}
      <div className="min-w-0 text-end">
        {current?.group && <p className="truncate text-[11px] text-navy/45">{current.group}</p>}
        <p className="truncate text-[16.5px] font-medium text-navy">{current?.label ?? "Ankora"}</p>
      </div>
    </header>
  );
}
