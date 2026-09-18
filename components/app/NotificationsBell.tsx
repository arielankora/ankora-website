"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { markAllNotificationsReadAction } from "@/app/(product)/app/(authenticated)/notifications/actions";

export type NotificationSummary = {
  id: string;
  title: string;
  body: string;
  createdAt: string; // ISO
  readAt: string | null;
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString("he-IL");
}

// App redesign (handoff README, App Shell section): "פעמון עם תג מונה אדום
// · ... פעמון פותח פופאובר התראות (רוחב 330px) עם 'סימון הכל כנקרא'."
// `notifications`/`unreadCount` come from the (authenticated) layout's own
// server-side fetch (listNotificationsForUser/unreadNotificationCount) -
// this component is presentation + the existing markAllNotificationsReadAction
// only, no new data-fetching logic.
export function NotificationsBell({
  notifications,
  unreadCount,
}: {
  notifications: NotificationSummary[];
  unreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="התראות"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-navy/60 hover:bg-navy/5 hover:text-navy"
      >
        <Bell size={18} strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-jbmono text-[10px] font-medium text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 top-11 z-50 w-[330px] rounded-2xl border border-lineDark bg-white shadow-[0_18px_44px_rgba(11,27,51,0.14)]">
          <div className="flex items-center justify-between border-b border-lineDark px-4 py-3">
            <p className="text-sm font-medium text-navy">התראות</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={pending}
                className="text-xs font-medium text-gold-dim hover:text-navy disabled:opacity-50"
              >
                סימון הכל כנקרא
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-navy/50">אין התראות</p>
            ) : (
              notifications.slice(0, 8).map((n) => (
                <div key={n.id} className="border-b border-lineDark/60 px-4 py-3 last:border-b-0">
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-navy">{n.title}</p>
                      <p className="mt-0.5 text-xs text-navy/60">{n.body}</p>
                      <p className="mt-1 font-jbmono text-[10.5px] text-navy/40">{relativeTime(n.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-lineDark px-4 py-2.5 text-center">
            <Link
              href="/app/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-gold-dim hover:text-navy"
            >
              כל ההתראות
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
