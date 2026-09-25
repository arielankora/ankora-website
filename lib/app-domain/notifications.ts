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

    // App redesign, Profile screen (screen 18, docs/adr/0001 section 23):
    // the persisted in-app Notification row above is unconditional either
    // way - only this extra email is gated by the user's own preference
    // (default true, so behavior is unchanged until someone opts out).
    if (entry.user.email && entry.user.notifyLongRunningTimerByEmail) {
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

// ---------------------------------------------------------------------
// Tasks: work that landed on somebody.
//
// Hadas, 25.9.2026: a task was opened on her and she did not notice.
//
// The bell, the unread counter in the nav and the /app/notifications
// screen have all existed since phase 9, and until now exactly two
// things wrote to them: a timer somebody forgot to stop, and a
// reminder from an important date. **Nothing about a task ever did.**
// So the only way to find out that work had landed on you was to open
// the app and look, which is the habit this product is supposed to be
// replacing rather than requiring.
//
// This is internal, to the team. The rule Ariel set on 25.9 is about
// clients, and nothing here reaches one.

export const TASK_ASSIGNED_NOTIFICATION_TYPE = "task_assigned";
export const TASK_SUPERVISING_NOTIFICATION_TYPE = "task_supervising";

/// Who, if anybody, needs to be told about this change.
///
/// Pure, and exported for the same reason `isPastLongTimerThreshold` is:
/// the interesting cases are all about who did what to whom, and none
/// of them need a database to answer.
///
/// Three rules, and the third is the one that matters most:
///
///   1. only somebody newly named, so an edit to a title does not
///      re-announce work that landed last week,
///   2. never yourself, because a person who has just assigned
///      themselves a task knows,
///   3. and the person REPLACED is not told. "It is no longer yours" is
///      a message with nothing to do attached, and the whole value of
///      this bell is that everything in it is something to act on.
export function whoToNotify(
  actorId: string,
  before: { assignedToId: string | null; supervisorId: string | null },
  after: { assignedToId: string | null; supervisorId: string | null }
): { userId: string; type: string }[] {
  const out: { userId: string; type: string }[] = [];
  if (after.assignedToId && after.assignedToId !== before.assignedToId && after.assignedToId !== actorId) {
    out.push({ userId: after.assignedToId, type: TASK_ASSIGNED_NOTIFICATION_TYPE });
  }
  if (after.supervisorId && after.supervisorId !== before.supervisorId && after.supervisorId !== actorId) {
    out.push({ userId: after.supervisorId, type: TASK_SUPERVISING_NOTIFICATION_TYPE });
  }
  return out;
}

/// Writes the rows `whoToNotify` asked for.
///
/// No email, deliberately. A task landing on somebody is almost never
/// urgent, and a message for each one is noise within a week. Noise is
/// how an alert loses trust, and an alert that has lost trust does not
/// get it back. The morning digest is where these turn into something
/// a person reads (lib/app-domain/task-digest.ts).
///
/// Never throws into the caller. A notification that fails must not
/// undo the assignment it was announcing, which is the same rule the
/// client-preferences notification follows in client-file.ts.
export async function notifyTaskPeople(
  actorId: string,
  task: { id: string; title: string; clientTitle: string | null },
  clientName: string,
  before: { assignedToId: string | null; supervisorId: string | null },
  after: { assignedToId: string | null; supervisorId: string | null }
): Promise<void> {
  const targets = whoToNotify(actorId, before, after);
  if (targets.length === 0) return;

  // The INTERNAL title. This is a message between colleagues, and the
  // sentence written for the client is the wrong one here: it says what
  // the client was promised, not what somebody has to go and do.
  const subject = task.title;

  for (const target of targets) {
    try {
      await prisma.notification.create({
        data: {
          userId: target.userId,
          type: target.type,
          title:
            target.type === TASK_ASSIGNED_NOTIFICATION_TYPE ? "משימה חדשה אצלך" : "מונית למפקח על משימה",
          body: `${subject} · ${clientName}`,
          entityType: "Task",
          entityId: task.id,
        },
      });
    } catch (err) {
      console.error("task notification failed:", err);
    }
  }
}
