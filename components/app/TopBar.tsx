"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import type { NavItem } from "./Sidebar";
import { LiveTimerPill } from "./LiveTimerPill";
import { NotificationsBell, type NotificationSummary } from "./NotificationsBell";
import { NEW_TASK_KEY, OPEN_DRAWER_EVENT, OPEN_DRAWER_PARAM, PENDING_OPEN_KEY, type OpenDrawerDetail } from "./drawer-keys";

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
            className="flex items-center gap-1.5 rounded-full bg-gold-gradient px-4 py-2 text-[13px] font-medium text-navy"
          >
            <Plus size={15} strokeWidth={2.25} />
            דיווח חדש
          </Link>
        )}
        {/* Ariel, 26.9.2026: a task is opened as often as time is
            logged, and it deserves the same place. Secondary styling so
            the two do not compete: time logging stays the primary action.
            On the tasks screen it opens the drawer in place; anywhere else
            it goes there and the drawer opens on arrival. */}
        {showPrimaryCta && (
          <Link
            href={`/app/tasks?${OPEN_DRAWER_PARAM}=${NEW_TASK_KEY}`}
            onClick={(e) => {
              if (pathname === "/app/tasks") {
                e.preventDefault();
                const detail: OpenDrawerDetail = { key: NEW_TASK_KEY, handled: false };
                window.dispatchEvent(new CustomEvent(OPEN_DRAWER_EVENT, { detail }));
                // The page's drawer has not hydrated yet: leave a note it
                // reads when it mounts. See PENDING_OPEN_KEY.
                if (!detail.handled) (window as unknown as Record<string, unknown>)[PENDING_OPEN_KEY] = NEW_TASK_KEY;
              }
            }}
            className="flex items-center gap-1.5 rounded-full border border-gold/60 bg-white px-4 py-2 text-[13px] font-medium text-navy hover:border-gold"
          >
            <Plus size={15} strokeWidth={2.25} />
            משימה חדשה
          </Link>
        )}
      </div>

      {/* Left (end) side: breadcrumb + screen title. */}
      <div className="min-w-0 text-end">
        {current?.group && <p className="truncate text-[11px] text-appNavy/45">{current.group}</p>}
        <p className="truncate text-[16.5px] font-medium text-appNavy">{current?.label ?? "Ankora"}</p>
      </div>
    </header>
  );
}
