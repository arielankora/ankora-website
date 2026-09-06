import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { LONG_TIMER_HOURS } from "@/lib/app-domain/reports";
import type { User } from "@prisma/client";

// Phase 9 gap-fix (docs/adr/0001 section 17.2): spec §11's "Notifications"
// screen (anomalies/long-timer warnings/internal alerts) and spec §6.1's
// "UI warning *and* email/internal notification once a timer exceeds a
// configurable threshold" - only the UI-badge half of the latter existed
// before this phase (app/(product)/app/timer/TimerWidget.tsx's amber
// badge past LONG_TIMER_HOURS). This file adds the persisted,
// user-visible half of both gaps: a Notification row list plus the actual
// email/notify step for long-running timers.
//
// Strictly self-service (see permissions.ts's Phase 9 comment): every
// function here is scoped to the caller's own userId, never anyone
// else's - there is no "view another user's notifications" capability to
// gate, so no permission check is needed beyond "is there a session."

export async function listNotificationsForUser(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function unreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationRead(actor: User, notificationId: string) {
  // Scoped by userId in the WHERE clause itself (not a separate
  // ForbiddenError check) - updateMany simply matches zero rows if the
  // notification belongs to someone else, which is indistinguishable from
  // "already read" from the caller's point of view and requires no
  // information disclosure about other users' notifications.
  await prisma.notification.updateMany({
    where: { id: notificationId, userId: actor.id },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(actor: User) {
  await prisma.notification.updateMany({
    where: { userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
}

/// Spec §6.1's missing half: scans every currently-running timer
/// (TimeEntry.endAt === null) past LONG_TIMER_HOURS and, for each one not
/// already notified, creates a persisted Notification row (so it shows up
/// in the new /app/notifications screen even after the live badge is out
/// of view) and sends an email to the timer's owner. Dedup key is
/// (type, entityId) - the same TimeEntry is never notified twice, even
/// across multiple daily cron runs, matching the AlertEvent dedup
/// precedent in lib/app-domain/alerts.ts.
///
/// Wired into the existing daily alerts-reconcile cron (spec 9.2's
/// "scheduled reconciliation") rather than a new job - see
/// app/api/cron/alerts-reconcile/route.ts - since Vercel Cron on this
/// plan only offers daily-or-coarser granularity, the same honest
/// approximation already documented for AlertRule reconciliation (ADR
/// section 11.3).
export const LONG_TIMER_NOTIFICATION_TYPE = "long_running_timer";

/// Pure predicate - a timer counts as "long-running" once it started at or
/// before (now - LONG_TIMER_HOURS). Extracted standalone (no Prisma
/// import) so it's unit-testable outside the Prisma import chain, same
/// workaround this engagement has used since Phase 3/4
/// (hour-banks.test.ts, alerts.test.ts): currentValueForThreshold(),
/// isThresholdBreached(), decideAlertAction() are all this same shape.
export function isPastLongTimerThreshold(startAt: Date, now: Date): boolean {
  const cutoff = now.getTime() - LONG_TIMER_HOURS * 3600_000;
  return startAt.getTime() <= cutoff;
}

/// Pure dedupe filter - same (type, entityId) dedup key precedent as
/// AlertEvent (lib/app-domain/alerts.ts): a TimeEntry that already has a
/// long-running-timer Notification row is never notified twice, even
/// across multiple daily cron runs. Generic over the entry shape so this
/// can be tested with plain object literals, no Prisma types required.
export function selectUnnotifiedEntries<T extends { id: string }>(
  entries: T[],
  alreadyNotifiedEntryIds: Iterable<string | null>
): T[] {
  const notified = new Set(alreadyNotifiedEntryIds);
  return entries.filter((e) => !notified.has(e.id));
}

export async function notifyLongRunningTimers(): Promise<{ notified: number }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - LONG_TIMER_HOURS * 3600_000);

  const runningEntries = await prisma.timeEntry.findMany({
    where: { endAt: null, deletedAt: null, startAt: { lte: cutoff } },
    include: { user: true, client: true },
  });

  if (runningEntries.length === 0) return { notified: 0 };

  const entryIds = runningEntries.map((e) => e.id);
  const alreadyNotified = await prisma.notification.findMany({
    where: { type: LONG_TIMER_NOTIFICATION_TYPE, entityId: { in: entryIds } },
    select: { entityId: true },
  });

  // Explicit type argument (not relying on inference from `entries`):
  // under this sandbox's un-generated Prisma placeholder client,
  // `runningEntries` types as `any`, and TS's generic inference falls
  // back to the constraint (`{ id: string }`) rather than `any` for an
  // `any`-typed argument - a known inference quirk, not a real bug (see
  // docs/adr/0001 section 18.10). `typeof runningEntries[number]` sidesteps
  // it in both this sandbox and a real `prisma generate` environment.
  const toNotify = selectUnnotifiedEntries<(typeof runningEntries)[number]>(
    runningEntries,
    alreadyNotified.map((n) => n.entityId)
  );
  let notified = 0;

  for (const entry of toNotify) {
    const hoursRunning = Math.floor((Date.now() - entry.startAt.getTime()) / 3600_000);
    const title = "טיימר רץ זמן ארוך";
    const body = `הטיימר עבור ${entry.client.name} רץ כבר ${hoursRunning} שעות ברצף. בדקו אם יש לעצור אותו.`;

    await prisma.notification.create({
      data: {
        userId: entry.userId,
        type: LONG_TIMER_NOTIFICATION_TYPE,
        title,
        body,
        entityType: "TimeEntry",
        entityId: entry.id,
      },
    });

    if (entry.user.email) {
      await sendEmail({
        to: [entry.user.email],
        subject: `Ankora - ${title}`,
        text: body,
      });
    }
    notified++;
  }

  return { notified };
}
