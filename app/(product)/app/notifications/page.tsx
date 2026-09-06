import { requireUser } from "@/lib/app-auth/session";
import { listNotificationsForUser } from "@/lib/app-domain/notifications";
import { AppShell } from "@/components/app/AppShell";
import { StatusBadge } from "@/components/app/StatusBadge";
import { markNotificationReadAction, markAllNotificationsReadAction } from "./actions";

export const metadata = { robots: { index: false, follow: false } };

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(date);
}

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec §11): in-app view of
// anomalies/long-timer warnings/internal alerts - previously nowhere to
// see these once the live UI badge scrolled out of view. Strictly
// self-service: every role, including CLIENT_USER, sees only their own
// notifications (see lib/app-domain/notifications.ts).
export default async function NotificationsPage() {
  const user = await requireUser();
  const notifications = await listNotificationsForUser(user.id);
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-navy">התראות שלי</h1>
            <p className="mt-1 text-sm text-navy/60">חריגות, טיימרים ארוכים והתראות פנימיות.</p>
          </div>
          {unreadCount > 0 && (
            <form action={markAllNotificationsReadAction}>
              <button type="submit" className="rounded-full border border-lineDark px-4 py-2 text-sm text-navy hover:border-gold">
                סימון הכול כנקרא
              </button>
            </form>
          )}
        </div>

        <div className="divide-y divide-lineDark rounded-2xl border border-lineDark bg-white">
          {notifications.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-navy/50">אין התראות כרגע.</p>
          )}
          {notifications.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-navy">{n.title}</p>
                  {!n.readAt && <StatusBadge label="חדש" tone="amber" />}
                </div>
                <p className="mt-1 text-sm text-navy/70">{n.body}</p>
                <p className="mt-1 text-xs text-navy/40">{formatDateTime(n.createdAt)}</p>
              </div>
              {!n.readAt && (
                <form action={markNotificationReadAction}>
                  <input type="hidden" name="notificationId" value={n.id} />
                  <button type="submit" className="whitespace-nowrap text-xs text-navy/50 hover:text-navy">
                    סימון כנקרא
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
