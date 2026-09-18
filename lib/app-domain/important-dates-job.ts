import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { sendEmail } from "@/lib/email";
import { canManageClients } from "@/lib/app-auth/permissions";
import { computeNextOccurrence } from "@/lib/app-domain/important-dates-recurrence";
import { computeHolidayOccurrencesForYear, type HolidayCalendarKey } from "@/lib/app-domain/important-dates-holidays";
import {
  buildReminderIdempotencyKey,
  buildAutoTaskOccurrenceKey,
  buildInAppReminderMessage,
  buildEmailReminderSubject,
  buildEmailReminderBody,
  buildEscalationMessage,
} from "@/lib/app-domain/important-dates-reminders";
import { localDateKey, TIMEZONE } from "@/lib/timezone";

// Phase 10: Important Dates ("מועדים חשובים") - daily job. Extends the
// existing once-daily Vercel Cron (app/api/cron/alerts-reconcile/route.ts)
// rather than introducing a second scheduler - same reasoning
// notifyLongRunningTimers() and reconcileAllClientAlerts() already
// established (ADR 11.3: this stack has no job queue or sub-daily
// scheduler, so daily is the coarsest-but-honest interpretation of the
// spec's "scheduled reconciliation").
//
// The brief's own worked "10 numbered steps" for this job were not
// carried forward into this session's task summary in full literal form
// (only that the daily job needed extending, with reminders/tasks/
// emails/retries/escalation as the named concerns). Rather than block on
// re-pasting the brief, the job below was designed here to cover every
// one of those named concerns end to end, structured as separable,
// independently-testable steps (matching this file's own internal
// ordering, each documented at its own function):
//   1. seedHolidayOccurrences   - materialize this/next year's holiday
//      ImportantDate rows for every enabled HolidayCalendarSubscription.
//   2. recomputeOccurrences     - advance nextOccurrenceAt for any date
//      whose cached value is stale (past, or a HANDLED_CURRENT date whose
//      handled occurrence has now passed - spec: "לאחר מעבר למופע הבא,
//      המועד חוזר למצב פעיל").
//   3. flagOverdueDates         - ACTIVE dates whose occurrence has
//      arrived move to NEEDS_ATTENTION (never overwrites a status the
//      user already actively set to something else, e.g. IN_PROGRESS).
//   4. createDueReminderOccurrences - materialize PENDING
//      ReminderOccurrence rows once "today" enters a rule's
//      daysBefore window, one per (rule, occurrenceYear, channel).
//   5. sendPendingReminders     - actually deliver PENDING occurrences
//      (in-app Notification + email), retry-eligible FAILED ones too.
//   6. createDueAutoTasks       - spec's "auto-create a Task" feature,
//      idempotent via Task.importantDateOccurrenceKey.
//   7. escalateUnhandledReminders - a rule's escalateAfterDays past its
//      own send, if the date is still not handled, notifies Ankora admins.
// Every step is individually try/caught inside reconcileImportantDates()
// so one date's bad data can never abort the rest of the run - same
// isolation precedent as reconcileAllClientAlerts() (lib/app-domain/alerts.ts).

const MAX_REMINDER_ATTEMPTS = 5;

function currentAndNextGregorianYear(now: Date): [number, number] {
  const year = Number(localDateKey(now, TIMEZONE).slice(0, 4));
  return [year, year + 1];
}

// ---------------------------------------------------------------------------
// 1. Holiday seeding (opt-in only - spec: "לעולם לא subscribe אוטומטית
//    לכל לקוח")
// ---------------------------------------------------------------------------

/// `scope` narrows which enabled subscriptions get processed - omitted
/// (undefined) for the daily cron's full sweep of every client, or
/// { clientId, calendarKey } for the instant, single-subscription seed
/// that setHolidayCalendarSubscription() (important-dates.ts) triggers
/// right after a client is subscribed (Ariel follow-up request: don't
/// make the user wait for tomorrow's 05:00 UTC cron to see the holidays
/// they just subscribed to). Scoping only changes which subscriptions
/// are read - the create-if-missing/dedupe logic below is identical
/// either way, so this never introduces a second code path to keep in
/// sync.
export async function seedHolidayOccurrences(
  now = new Date(),
  scope?: { clientId?: string; calendarKey?: string }
): Promise<{ created: number }> {
  const subscriptions = await prisma.holidayCalendarSubscription.findMany({
    where: {
      enabled: true,
      ...(scope?.clientId ? { clientId: scope.clientId } : {}),
      ...(scope?.calendarKey ? { calendarKey: scope.calendarKey } : {}),
    },
  });
  if (subscriptions.length === 0) return { created: 0 };

  const [thisYear, nextYear] = currentAndNextGregorianYear(now);
  let created = 0;

  for (const sub of subscriptions) {
    const calendarKey = sub.calendarKey as HolidayCalendarKey;
    for (const year of [thisYear, nextYear]) {
      let occurrences: ReturnType<typeof computeHolidayOccurrencesForYear>;
      try {
        occurrences = computeHolidayOccurrencesForYear(calendarKey, year);
      } catch {
        continue; // Unknown/removed calendarKey - skip rather than fail the whole run.
      }

      for (const occ of occurrences) {
        // Dedupe is the DB's job (@@unique([clientId, holidayKey])) - the
        // same "constraint is the real guarantee, this check is just to
        // avoid a pointless round-trip" two-layer pattern as
        // TimeEntry's one-active-timer index. A holiday reachable from
        // two subscribed calendars for the same client is still only
        // ever created once, because holidayKey is the same catalog key
        // regardless of which calendar surfaced it.
        const existing = await prisma.importantDate.findUnique({
          where: { clientId_holidayKey: { clientId: sub.clientId, holidayKey: occ.key } },
        });
        if (existing) continue;

        try {
          const created_ = await prisma.importantDate.create({
            data: {
              clientId: sub.clientId,
              title: occ.labelHe,
              type: occ.labelHe,
              category: "GENERAL",
              calendarType: "GREGORIAN",
              month: occ.date.getUTCMonth() + 1,
              day: occ.date.getUTCDate(),
              recurrence: "ANNUAL",
              responsibleUserId: sub.responsibleUserId ?? (await fallbackResponsibleUser(sub.clientId)),
              additionalUserIds: [],
              extraEmailRecipients: [],
              status: "ACTIVE",
              sensitivity: "NORMAL",
              createAutoTask: sub.createTasks,
              nextOccurrenceAt: occ.date,
              source: "HOLIDAY",
              holidayKey: occ.key,
              reminderRules: {
                create: (sub.defaultReminderDaysBefore.length > 0 ? sub.defaultReminderDaysBefore : occ.defaultReminderDaysBefore).map(
                  (daysBefore) => ({ daysBefore, sendInApp: true, sendEmail: false, extraAnkoraRecipients: [], clientRecipients: [] })
                ),
              },
            },
          });
          created++;
          await recordAudit({
            actorId: null,
            action: "important_date.auto_create_holiday",
            entityType: "ImportantDate",
            entityId: created_.id,
            clientId: sub.clientId,
          });
        } catch {
          // Unique-constraint race (two overlapping cron runs) - fine, skip.
          continue;
        }
      }
    }
  }

  return { created };
}

/// A holiday date needs SOME responsibleUserId (the column is required -
/// see prisma/schema.prisma). When a HolidayCalendarSubscription doesn't
/// name one, falls back to the client's own oldest UserClientAccess
/// admin, or failing that, any SUPER_ADMIN - documented default so
/// seeding never hard-fails a client that opted in without picking an
/// owner.
async function fallbackResponsibleUser(clientId: string): Promise<string> {
  const access = await prisma.userClientAccess.findFirst({ where: { clientId }, include: { user: true }, orderBy: { createdAt: "asc" } });
  if (access) return access.userId;
  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (admin) return admin.id;
  throw new Error(`No responsible user available for holiday seeding on client ${clientId}`);
}

// ---------------------------------------------------------------------------
// 2 + 3. Occurrence rollover + overdue flagging
// ---------------------------------------------------------------------------

export async function recomputeOccurrences(now = new Date()): Promise<{ updated: number }> {
  const todayKey = localDateKey(now, TIMEZONE);

  const candidates = await prisma.importantDate.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ["ARCHIVED", "PAUSED"] },
      OR: [{ nextOccurrenceAt: null }, { nextOccurrenceAt: { lt: now } }],
    },
  });

  let updated = 0;
  for (const date of candidates) {
    // A ONCE date whose one occurrence has passed has no "next" - leave
    // nextOccurrenceAt as-is (it stays the historical date) and let the
    // overdue-flagging step below (or the user) decide its fate; it is
    // never silently recomputed into some other date.
    if (date.recurrence === "ONCE") continue;

    const next = computeNextOccurrence(
      {
        calendarType: date.calendarType,
        month: date.month,
        day: date.day,
        recurrence: date.recurrence,
        onceDate: date.onceDate,
        customIntervalDays: date.customIntervalDays,
        originYear: date.originYear,
        leapDayUseMarchFirst: date.leapDayUseMarchFirst,
        hebrewAdarTwoInLeapYear: date.hebrewAdarTwoInLeapYear,
        timezone: date.timezone,
      },
      now
    );
    if (!next || next.getTime() === date.nextOccurrenceAt?.getTime()) continue;

    // Spec: "לאחר מעבר למופע הבא, המועד חוזר למצב פעיל" - a
    // HANDLED_CURRENT date whose handled occurrence (currentOccurrenceAt)
    // is now in the past rolls back to ACTIVE for the new occurrence.
    const rollsBackToActive = date.status === "HANDLED_CURRENT" && date.currentOccurrenceAt && localDateKey(date.currentOccurrenceAt, TIMEZONE) < todayKey;

    await prisma.importantDate.update({
      where: { id: date.id },
      data: {
        nextOccurrenceAt: next,
        status: rollsBackToActive ? "ACTIVE" : undefined,
      },
    });
    updated++;
  }

  return { updated };
}

export async function flagOverdueDates(now = new Date()): Promise<{ flagged: number }> {
  const result = await prisma.importantDate.updateMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      nextOccurrenceAt: { lt: now },
      recurrence: { not: "ONCE" }, // A ONCE date past due is left to the user/ARCHIVED, not flagged forever.
    },
    data: { status: "NEEDS_ATTENTION" },
  });
  return { flagged: result.count };
}

// ---------------------------------------------------------------------------
// 4 + 5. Reminders
// ---------------------------------------------------------------------------

export async function createDueReminderOccurrences(now = new Date()): Promise<{ created: number }> {
  const dates = await prisma.importantDate.findMany({
    where: { deletedAt: null, status: { notIn: ["ARCHIVED", "PAUSED"] }, nextOccurrenceAt: { not: null } },
    include: { reminderRules: { where: { enabled: true } }, client: true },
  });

  let created = 0;
  for (const date of dates) {
    if (!date.nextOccurrenceAt) continue;
    const occurrenceYear = date.nextOccurrenceAt.getUTCFullYear();

    for (const rule of date.reminderRules) {
      const dueAt = new Date(date.nextOccurrenceAt.getTime() - rule.daysBefore * 86_400_000);
      if (dueAt.getTime() > now.getTime()) continue; // Reminder window hasn't opened yet.

      const channels: Array<"IN_APP" | "EMAIL"> = [];
      if (rule.sendInApp) channels.push("IN_APP");
      if (rule.sendEmail) channels.push("EMAIL");

      for (const channel of channels) {
        const idempotencyKey = buildReminderIdempotencyKey({ importantDateId: date.id, reminderRuleId: rule.id, occurrenceYear, channel });
        try {
          await prisma.reminderOccurrence.create({
            data: {
              importantDateId: date.id,
              reminderRuleId: rule.id,
              occurrenceYear,
              occurrenceDate: date.nextOccurrenceAt,
              channel,
              recipientUserId: channel === "IN_APP" ? date.responsibleUserId : null,
              scheduledFor: dueAt,
              status: "PENDING",
              idempotencyKey,
            },
          });
          created++;
        } catch {
          continue; // Unique idempotencyKey violation - already created this run or a prior one.
        }
      }
    }
  }

  return { created };
}

export async function sendPendingReminders(now = new Date()): Promise<{ sent: number; failed: number }> {
  const due = await prisma.reminderOccurrence.findMany({
    where: {
      OR: [
        { status: "PENDING" },
        { status: "FAILED", attempts: { lt: MAX_REMINDER_ATTEMPTS } },
      ],
      scheduledFor: { lte: now },
    },
    include: { importantDate: { include: { client: true, responsibleUser: true } }, reminderRule: true },
  });

  let sent = 0;
  let failed = 0;

  for (const occ of due) {
    const date = occ.importantDate;
    const daysBefore = Math.round((date.nextOccurrenceAt!.getTime() - occ.occurrenceDate.getTime()) / 86_400_000) + (occ.reminderRule?.daysBefore ?? 0);
    const messageInput = {
      clientName: date.client.name,
      dateTitle: date.title,
      occurrenceDate: localDateKey(occ.occurrenceDate, TIMEZONE).split("-").reverse().join("/"),
      daysBefore: occ.reminderRule?.daysBefore ?? 0,
    };
    void daysBefore;

    try {
      if (occ.channel === "IN_APP") {
        await prisma.notification.create({
          data: {
            userId: occ.recipientUserId ?? date.responsibleUserId,
            type: "important_date.reminder",
            title: date.title,
            body: buildInAppReminderMessage(messageInput),
            entityType: "ImportantDate",
            entityId: date.id,
          },
        });
        await prisma.reminderOccurrence.update({ where: { id: occ.id }, data: { status: "SENT", sentAt: now, attemptedAt: now, attempts: { increment: 1 } } });
        sent++;
      } else {
        const recipients = Array.from(
          new Set([occ.recipientEmail, date.responsibleUser.email, ...date.extraEmailRecipients, ...(occ.reminderRule?.extraAnkoraRecipients ?? [])].filter((e): e is string => Boolean(e)))
        );
        const result = await sendEmail({
          to: recipients,
          subject: buildEmailReminderSubject(messageInput),
          text: buildEmailReminderBody(messageInput),
        });
        await prisma.reminderOccurrence.update({
          where: { id: occ.id },
          data: {
            status: result.ok ? "SENT" : "FAILED",
            sentAt: result.ok ? now : undefined,
            attemptedAt: now,
            attempts: { increment: 1 },
            error: result.ok ? null : result.error ?? "Unknown error",
            providerMessageId: result.ok ? result.providerMessageId ?? undefined : undefined,
          },
        });
        if (result.ok) sent++;
        else failed++;
      }
    } catch (err: any) {
      await prisma.reminderOccurrence.update({
        where: { id: occ.id },
        data: { status: "FAILED", attemptedAt: now, attempts: { increment: 1 }, error: err?.message ?? "Unknown error" },
      });
      failed++;
    }
  }

  return { sent, failed };
}

// ---------------------------------------------------------------------------
// 6. Auto-created tasks
// ---------------------------------------------------------------------------

export async function createDueAutoTasks(now = new Date()): Promise<{ created: number }> {
  const dates = await prisma.importantDate.findMany({
    where: { deletedAt: null, createAutoTask: true, status: { notIn: ["ARCHIVED", "PAUSED"] }, nextOccurrenceAt: { not: null } },
  });

  let created = 0;
  for (const date of dates) {
    if (!date.nextOccurrenceAt) continue;
    const leadDays = date.autoTaskLeadDays ?? 0;
    const dueAt = new Date(date.nextOccurrenceAt.getTime() - leadDays * 86_400_000);
    if (dueAt.getTime() > now.getTime()) continue;

    const occurrenceYear = date.nextOccurrenceAt.getUTCFullYear();
    const occurrenceKey = buildAutoTaskOccurrenceKey(occurrenceYear);

    try {
      const task = await prisma.task.create({
        data: {
          clientId: date.clientId,
          categoryId: date.autoTaskCategoryId,
          title: date.title,
          assignedToId: date.responsibleUserId,
          dueDate: date.nextOccurrenceAt,
          importantDateId: date.id,
          importantDateOccurrenceKey: occurrenceKey,
        },
      });
      created++;
      await recordAudit({
        actorId: null,
        action: "task.auto_create_from_important_date",
        entityType: "Task",
        entityId: task.id,
        clientId: date.clientId,
      });
    } catch {
      continue; // Unique (importantDateId, importantDateOccurrenceKey) violation - already created.
    }
  }

  return { created };
}

// ---------------------------------------------------------------------------
// 7. Escalation
// ---------------------------------------------------------------------------

export async function escalateUnhandledReminders(now = new Date()): Promise<{ escalated: number }> {
  const candidates = await prisma.reminderOccurrence.findMany({
    where: { status: "SENT", channel: "EMAIL" },
    include: {
      reminderRule: true,
      importantDate: { include: { client: true, responsibleUser: true } },
    },
  });

  let escalated = 0;
  let cachedAdminEmails: string[] | null = null;
  async function getAdminEmails(): Promise<string[]> {
    if (cachedAdminEmails) return cachedAdminEmails;
    const admins = await prisma.user.findMany({ where: { role: { in: ["SUPER_ADMIN", "ANKORA_ADMIN"] } }, select: { email: true, role: true } });
    // Let TS infer a.role/a.email from Prisma's real generated select-result type.
    const emails: string[] = admins
      .filter((a) => canManageClients(a.role))
      .map((a) => a.email)
      .filter((e): e is string => Boolean(e));
    cachedAdminEmails = emails;
    return emails;
  }

  for (const occ of candidates) {
    const rule = occ.reminderRule;
    if (!rule?.escalateToManager || !rule.escalateAfterDays || !occ.sentAt) continue;

    const date = occ.importantDate;
    // Already handled? Nothing to escalate.
    if (["HANDLED_CURRENT", "ARCHIVED", "PAUSED"].includes(date.status)) continue;

    const escalateAt = new Date(occ.sentAt.getTime() + rule.escalateAfterDays * 86_400_000);
    if (escalateAt.getTime() > now.getTime()) continue;

    // Idempotency: an escalation is itself modeled as a second
    // ReminderOccurrence row (channel EMAIL, a synthetic reminderRuleId
    // suffix) so it benefits from the exact same unique-key dedupe as any
    // other reminder, rather than inventing a parallel "escalated"
    // boolean flag that could drift out of sync under concurrent cron runs.
    const escalationKey = `${occ.idempotencyKey}:escalation`;
    const already = await prisma.reminderOccurrence.findUnique({ where: { idempotencyKey: escalationKey } });
    if (already) continue;

    const adminEmails = await getAdminEmails();
    if (!adminEmails.length) continue;

    const messageInput = {
      clientName: date.client.name,
      dateTitle: date.title,
      occurrenceDate: localDateKey(occ.occurrenceDate, TIMEZONE).split("-").reverse().join("/"),
      daysBefore: 0,
      originalResponsibleName: date.responsibleUser.name ?? date.responsibleUser.email,
    };

    const result = await sendEmail({
      to: adminEmails,
      subject: `הסלמה: ${date.title} - ${date.client.name}`,
      text: buildEscalationMessage(messageInput),
    });

    await prisma.reminderOccurrence.create({
      data: {
        importantDateId: date.id,
        reminderRuleId: rule.id,
        occurrenceYear: occ.occurrenceYear,
        occurrenceDate: occ.occurrenceDate,
        channel: "EMAIL",
        scheduledFor: now,
        status: result.ok ? "SENT" : "FAILED",
        sentAt: result.ok ? now : undefined,
        attemptedAt: now,
        attempts: 1,
        error: result.ok ? null : result.error ?? "Unknown error",
        idempotencyKey: escalationKey,
      },
    });

    if (result.ok) escalated++;
  }

  return { escalated };
}

// ---------------------------------------------------------------------------
// Entry point - called from app/api/cron/alerts-reconcile/route.ts
// ---------------------------------------------------------------------------

export async function reconcileImportantDates(now = new Date()) {
  const results = {
    holidaysSeeded: 0,
    occurrencesRecomputed: 0,
    flaggedOverdue: 0,
    remindersCreated: 0,
    remindersSent: 0,
    remindersFailed: 0,
    autoTasksCreated: 0,
    escalated: 0,
    errors: [] as string[],
  };

  // Each step is isolated - one failing step (bad data on a single
  // client, a transient DB hiccup) never prevents the others from
  // running, matching reconcileAllClientAlerts()'s per-client isolation.
  const steps: Array<[string, () => Promise<void>]> = [
    ["seedHolidayOccurrences", async () => { results.holidaysSeeded = (await seedHolidayOccurrences(now)).created; }],
    ["recomputeOccurrences", async () => { results.occurrencesRecomputed = (await recomputeOccurrences(now)).updated; }],
    ["flagOverdueDates", async () => { results.flaggedOverdue = (await flagOverdueDates(now)).flagged; }],
    ["createDueReminderOccurrences", async () => { results.remindersCreated = (await createDueReminderOccurrences(now)).created; }],
    ["sendPendingReminders", async () => {
      const r = await sendPendingReminders(now);
      results.remindersSent = r.sent;
      results.remindersFailed = r.failed;
    }],
    ["createDueAutoTasks", async () => { results.autoTasksCreated = (await createDueAutoTasks(now)).created; }],
    ["escalateUnhandledReminders", async () => { results.escalated = (await escalateUnhandledReminders(now)).escalated; }],
  ];

  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err: any) {
      console.error(`important-dates-job step "${name}" failed:`, err);
      results.errors.push(`${name}: ${err?.message ?? "Unknown error"}`);
    }
  }

  return results;
}
