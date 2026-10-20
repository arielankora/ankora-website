import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { listNotificationsForUser } from "@/lib/app-domain/notifications";
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
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-app-text-primary">התראות שלי</h1>
            <p className="mt-1 text-sm text-app-text-secondary">חריגות, טיימרים ארוכים והתראות פנימיות.</p>
          </div>
          {unreadCount > 0 && (
            <form action={markAllNotificationsReadAction}>
              <button type="submit" className="rounded-full border border-app-border px-4 py-2 text-sm text-app-text-primary hover:border-gold">
                סימון הכול כנקרא
              </button>
            </form>
          )}
        </div>

        <div className="divide-y divide-app-border rounded-2xl border border-app-border bg-white">
          {notifications.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-app-text-tertiary">אין התראות כרגע.</p>
          )}
          {notifications.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  {/* Tasks: the row is a way in, not only a record. A
                      notification about work that landed on you and
                      cannot be opened from here is a notification that
                      sends you to go and look for it. */}
                  {n.entityType === "Task" && n.entityId ? (
                    <Link href={`/app/tasks/${n.entityId}`} className="font-medium text-app-text-primary hover:text-app-text-accent">
                      {n.title}
                    </Link>
                  ) : n.entityType === "Client" && n.entityId ? (
                    // The client file's weekly look: straight to the file.
                    <Link href={`/app/clients/${n.entityId}/client-file`} className="font-medium text-app-text-primary hover:text-app-text-accent">
                      {n.title}
                    </Link>
                  ) : n.entityType === "ClientRules" && n.entityId ? (
                    // An exception to a rule: to the rules, where it is decided.
                    <Link href={`/app/clients/${n.entityId}?tab=file#rules`} className="font-medium text-app-text-primary hover:text-app-text-accent">
                      {n.title}
                    </Link>
                  ) : n.entityType === "ClientProcesses" && n.entityId ? (
                    // A routine check that is due: to the client's processes.
                    <Link href={`/app/clients/${n.entityId}?tab=file#processes`} className="font-medium text-app-text-primary hover:text-app-text-accent">
                      {n.title}
                    </Link>
                  ) : n.entityType === "Knowledge" && n.entityId ? (
                    <Link href={`/app/approvals?tab=knowledge&clientId=${n.entityId}`} className="font-medium text-app-text-primary hover:text-app-text-accent">
                      {n.title}
                    </Link>
                  ) : (
                    <p className="font-medium text-app-text-primary">{n.title}</p>
                  )}
                  {!n.readAt && <StatusBadge label="חדש" tone="amber" />}
                </div>
                <p className="mt-1 text-sm text-app-text-secondary">{n.body}</p>
                <p className="mt-1 text-xs text-app-text-tertiary">{formatDateTime(n.createdAt)}</p>
              </div>
              {!n.readAt && (
                <form action={markNotificationReadAction}>
                  <input type="hidden" name="notificationId" value={n.id} />
                  <button type="submit" className="whitespace-nowrap text-xs text-app-text-tertiary hover:text-app-text-primary">
                    סימון כנקרא
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
