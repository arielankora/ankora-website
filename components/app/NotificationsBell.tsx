"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { noTranslateProps } from "@/components/app/NoMachineTranslation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { markAllNotificationsReadAction } from "@/app/(product)/app/(authenticated)/notifications/actions";

export type NotificationSummary = {
  id: string;
  title: string;
  body: string;
  createdAt: string; // ISO
  readAt: string | null;
  /// Where the row leads. Only tasks today; anything else stays text.
  href?: string | null;
  /// ADR 0006: about something marked "בלי AI", so the row is kept from
  /// the browser's translator.
  aiExcluded?: boolean;
};

/// The same steps as before ADR 0006, now worded by the dictionary. Past a
/// week it is a date, in the person's own locale and time zone.
function useRelativeTime(): (iso: string) => string {
  const t = useTranslations("shell.notifications");
  const format = useFormatter();
  return (iso) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return t("now");
    if (minutes < 60) return t("minutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t("daysAgo", { count: days });
    return format.dateTime(new Date(iso), { day: "numeric", month: "numeric", year: "numeric" });
  };
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
  const t = useTranslations("shell.notifications");
  const relativeTime = useRelativeTime();

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
        aria-label={t("title")}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-app-text-secondary hover:bg-app-surface-sunken hover:text-app-text-primary"
      >
        <Bell size={18} strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-app-error px-1 font-jbmono text-[10px] font-medium text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 top-11 z-50 w-[330px] rounded-2xl border border-app-border bg-white shadow-[0_18px_44px_rgba(11,27,51,0.14)]">
          <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
            <p className="text-sm font-medium text-app-text-primary">{t("title")}</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={pending}
                className="text-xs font-medium text-app-text-accent hover:text-app-text-primary disabled:opacity-50"
              >
                {t("markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-app-text-tertiary">{t("empty")}</p>
            ) : (
              notifications.slice(0, 8).map((n) => {
                const inner = (
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-app-text-primary">{n.title}</p>
                      <p className="mt-0.5 text-xs text-app-text-secondary">{n.body}</p>
                      <p className="mt-1 font-jbmono text-[10.5px] text-app-text-tertiary">{relativeTime(n.createdAt)}</p>
                    </div>
                  </div>
                );
                // 6.10.2026: a bell row about a task that could not be
                // clicked sent people looking for the task by name. The
                // task screen marks the row read when it opens.
                return n.href ? (
                  <Link
                    key={n.id}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    {...noTranslateProps(n.aiExcluded)}
                    className="block border-b border-app-border px-4 py-3 last:border-b-0 hover:bg-app-surface-sunken"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id} {...noTranslateProps(n.aiExcluded)} className="border-b border-app-border px-4 py-3 last:border-b-0">
                    {inner}
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-app-border px-4 py-2.5 text-center">
            <Link
              href="/app/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-app-text-accent hover:text-app-text-primary"
            >
              {t("all")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
