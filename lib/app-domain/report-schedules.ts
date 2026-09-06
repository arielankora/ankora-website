import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { sendEmail } from "@/lib/email";
import { toCsv } from "@/lib/csv";
import { getClient } from "@/lib/app-domain/clients";
import { localDateKey, localDateTimeToUtc } from "@/lib/timezone";
import type { User, ReportSchedule, ClientReportType, ReportFrequency } from "@prisma/client";

// Phase 6 domain service: spec section 15 ("דוחות מתוזמנים במייל"). Owns
// ReportSchedule CRUD, the due-calculation (isScheduleDue - a pure function,
// unit tested independently of the database per this engagement's standing
// pattern for exactly this kind of scheduling decision, e.g. Phase 4's
// decideAlertAction), and the actual snapshot-then-send flow that produces
// the "Snapshot/Report run id" spec 15 explicitly requires
// ("לפני שליחה ליצור Snapshot/Report run id כדי שיהיה ניתן לדעת בדיוק מה
// נשלח").

export interface ReportScheduleInput {
  reportType: ClientReportType;
  frequency: ReportFrequency;
  recipients: string[];
  timezone?: string;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  hour?: number;
  enabled?: boolean;
}

function normalizeEmails(emails: string[]): string[] {
  return Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0)));
}

// ---------------------------------------------------------------------------
// CRUD (Ankora-only, per ADR Phase 6 addendum - see report.internal.view's
// own doc comment for why this stays consistent with the Reports screen's
// permission rather than inventing a separate one).
// ---------------------------------------------------------------------------

export async function listReportSchedulesForClient(actor: User, clientId: string) {
  assertCan(actor.role, "report.internal.view");
  return prisma.reportSchedule.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    include: { runs: { orderBy: { periodStart: "desc" }, take: 5 } },
  });
}

export async function createReportSchedule(actor: User, clientId: string, input: ReportScheduleInput) {
  assertCan(actor.role, "report.internal.view");

  const schedule = await prisma.reportSchedule.create({
    data: {
      clientId,
      reportType: input.reportType,
      frequency: input.frequency,
      recipients: normalizeEmails(input.recipients),
      timezone: input.timezone ?? "Asia/Jerusalem",
      dayOfWeek: input.frequency === "WEEKLY" ? input.dayOfWeek ?? 0 : null,
      dayOfMonth: input.frequency === "MONTHLY" ? Math.min(28, Math.max(1, input.dayOfMonth ?? 1)) : null,
      hour: Math.min(23, Math.max(0, input.hour ?? 7)),
      enabled: input.enabled ?? true,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "report_schedule.create",
    entityType: "ReportSchedule",
    entityId: schedule.id,
    clientId,
    after: schedule,
  });

  return schedule;
}

export async function updateReportSchedule(actor: User, scheduleId: string, input: Partial<ReportScheduleInput>) {
  assertCan(actor.role, "report.internal.view");

  const before = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
  const frequency = input.frequency ?? before.frequency;

  const schedule = await prisma.reportSchedule.update({
    where: { id: scheduleId },
    data: {
      ...(input.reportType !== undefined ? { reportType: input.reportType } : {}),
      ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
      ...(input.recipients !== undefined ? { recipients: normalizeEmails(input.recipients) } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      dayOfWeek: frequency === "WEEKLY" ? input.dayOfWeek ?? before.dayOfWeek ?? 0 : null,
      dayOfMonth:
        frequency === "MONTHLY"
          ? Math.min(28, Math.max(1, input.dayOfMonth ?? before.dayOfMonth ?? 1))
          : null,
      ...(input.hour !== undefined ? { hour: Math.min(23, Math.max(0, input.hour)) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "report_schedule.update",
    entityType: "ReportSchedule",
    entityId: schedule.id,
    clientId: schedule.clientId,
    before,
    after: schedule,
  });

  return schedule;
}

export async function deleteReportSchedule(actor: User, scheduleId: string) {
  assertCan(actor.role, "report.internal.view");

  const before = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
  await prisma.reportSchedule.delete({ where: { id: scheduleId } });

  await recordAudit({
    actorId: actor.id,
    action: "report_schedule.delete",
    entityType: "ReportSchedule",
    entityId: scheduleId,
    clientId: before.clientId,
    before,
  });

  return before;
}

// ---------------------------------------------------------------------------
// Due calculation (pure function - unit-testable without a database)
// ---------------------------------------------------------------------------

/// Whether `schedule` is due to send at `now`, given its own timezone/
/// dayOfWeek|dayOfMonth fields and when it last sent. Deliberately a pure
/// function over plain data (same pattern as Phase 4's decideAlertAction)
/// so the scheduling logic is independently testable without a database
/// or a real clock. `now` is assumed UTC; the schedule's own local
/// wall-clock day is computed via Intl (no extra timezone library
/// dependency - the codebase has none, and Intl.DateTimeFormat's
/// timeZone option is sufficient for "what day is it right now in this
/// IANA zone").
///
/// Infra constraint, not a spec gap: this project's Vercel plan (Hobby)
/// only runs Cron Jobs once per day, so app/api/cron/scheduled-reports's
/// actual trigger time is fixed (see vercel.json) regardless of any
/// individual schedule's own `hour` field. isScheduleDue therefore checks
/// day-of-week/day-of-month only, never `hour` - `hour` is still stored
/// and shown in the admin UI (spec 15: "כל Schedule שומר timezone,
/// recipients, report type, filters...") as the client's stated
/// preference, ready to be honored exactly once this project moves to a
/// plan/infra with finer-grained scheduling, but it is not load-bearing
/// today. Documented in the ADR addendum.
export function isScheduleDue(
  schedule: Pick<ReportSchedule, "frequency" | "timezone" | "dayOfWeek" | "dayOfMonth" | "lastSentAt" | "enabled">,
  now: Date
): boolean {
  if (!schedule.enabled) return false;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone,
    weekday: "short",
    day: "numeric",
  }).formatToParts(now);

  const localDay = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);

  const matchesCadence =
    schedule.frequency === "WEEKLY" ? weekdayIndex === (schedule.dayOfWeek ?? 0) : localDay === (schedule.dayOfMonth ?? 1);
  if (!matchesCadence) return false;

  // Don't re-send within the same day a cron already fired in (the cron
  // runs once/day, but this guards against a manual re-trigger of the
  // route on the same day) - the ReportRun unique constraint remains the
  // hard idempotency guarantee for the actual send; this is the cheap
  // pre-check that avoids even computing/attempting a duplicate.
  if (schedule.lastSentAt && now.getTime() - schedule.lastSentAt.getTime() < 20 * 3600_000) return false;

  return true;
}

/// The period a schedule is reporting ON, as of `now` - spec 15's own
/// examples ("Weekly report... עבור השבוע הקודם", "Monthly report...
/// עבור החודש הקודם"): both cadences report on the PRECEDING complete
/// period, never the one still in progress.
///
/// Phase 8 fix: this used to compute week/month boundaries from `now`'s
/// UTC calendar fields (`getUTCDay()`/`getUTCMonth()`), which is wrong for
/// a schedule whose `timezone` is Asia/Jerusalem (the only value ever
/// configured in practice) - `isScheduleDue` right above already
/// correctly reads `now`'s LOCAL weekday/day-of-month via
/// Intl.DateTimeFormat before deciding to fire, but the period this
/// function then computed for that same fire was in a different
/// calendar (UTC's), so near a week/month boundary the two could
/// disagree about which day it locally is. Now: read `now`'s local
/// Y-M-D (`localDateKey`), do calendar arithmetic on those plain
/// numbers (weekday-of-a-date and month-rollover are timezone-free once
/// you have Y-M-D - JS's own Date.UTC normalizes month/day overflow
/// correctly), then convert the resulting local boundary dates back to
/// real UTC instants (`localDateTimeToUtc`) for the Prisma range query.
export function computeReportingPeriod(
  frequency: ReportFrequency,
  now: Date,
  timeZone: string = "Asia/Jerusalem"
): { from: Date; to: Date } {
  const [y, m, d] = localDateKey(now, timeZone).split("-").map(Number);

  if (frequency === "WEEKLY") {
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // weekday of a calendar date is tz-independent
    const startOfThisWeek = new Date(Date.UTC(y, m - 1, d - weekday));
    const startOfLastWeek = new Date(Date.UTC(y, m - 1, d - weekday - 7));
    return {
      from: localDateTimeToUtc(startOfLastWeek.toISOString().slice(0, 10), "00:00", timeZone),
      to: localDateTimeToUtc(startOfThisWeek.toISOString().slice(0, 10), "00:00", timeZone),
    };
  }

  const startOfThisMonth = new Date(Date.UTC(y, m - 1, 1));
  const startOfLastMonth = new Date(Date.UTC(y, m - 2, 1));
  return {
    from: localDateTimeToUtc(startOfLastMonth.toISOString().slice(0, 10), "00:00", timeZone),
    to: localDateTimeToUtc(startOfThisMonth.toISOString().slice(0, 10), "00:00", timeZone),
  };
}

// ---------------------------------------------------------------------------
// Snapshot + send
// ---------------------------------------------------------------------------

const REPORT_TYPE_LABELS: Record<ClientReportType, string> = {
  MONTHLY_DETAILED: "דוח חודשי מפורט",
  WEEKLY_ACTIVITY: "פעילות שבועית",
  HOURS_BY_CATEGORY: "סיכום קטגוריות",
  HOUR_BANK_STATUS: "סטטוס בנק שעות",
};

/// Builds the exact same shape of data the corresponding Client Portal
/// screen shows, for an arbitrary [from,to) window - reused for both the
/// frozen ReportRun snapshot and the email body, so "what the client
/// portal shows" and "what the scheduled email says" can never drift.
/// Deliberately does NOT go through resolvePortalClient (that resolves
/// the CALLER's own client from their session) - the cron has no
/// CLIENT_USER session, it already knows which client's schedule it's
/// running, so this operates directly on clientId/date range.
async function buildSnapshot(clientId: string, reportType: ClientReportType, from: Date, to: Date) {
  switch (reportType) {
    case "HOUR_BANK_STATUS": {
      const client = await getClient(clientId);
      const snapshot = await prisma.hourBank.findFirst({
        where: { clientId, deletedAt: null, cycleStart: { lte: to }, cycleEnd: { gt: from } },
        orderBy: { cycleStart: "desc" },
      });
      return { reportType, client: client?.name, cycle: snapshot };
    }
    case "WEEKLY_ACTIVITY": {
      const client = await getClient(clientId);
      const entries = await prisma.timeEntry.findMany({
        where: { clientId, deletedAt: null, endAt: { not: null }, startAt: { gte: from, lt: to } },
        include: { category: true, task: true, user: true },
      });
      const showNames = client?.portalShowEmployeeNames ?? true;
      return {
        reportType,
        client: client?.name,
        rows: entries.map((e) => ({
          date: localDateKey(e.startAt), // Phase 8 fix: was UTC-date via toISOString(), wrong near Israel midnight
          activity: e.task?.title ?? e.category.name,
          category: e.category.name,
          billableMinutes: Math.round((e.billableSeconds ?? 0) / 60),
          ...(showNames ? { employee: e.user.name } : {}),
        })),
      };
    }
    case "MONTHLY_DETAILED": {
      const client = await getClient(clientId);
      const entries = await prisma.timeEntry.findMany({
        where: { clientId, deletedAt: null, endAt: { not: null }, startAt: { gte: from, lt: to } },
        include: { category: true, task: true, user: true },
      });
      const showNames = client?.portalShowEmployeeNames ?? true;
      return {
        reportType,
        client: client?.name,
        rows: entries.map((e) => ({
          date: localDateKey(e.startAt), // Phase 8 fix: was UTC-date via toISOString(), wrong near Israel midnight
          activity: e.task?.title ?? e.category.name,
          category: e.category.name,
          billableMinutes: Math.round((e.billableSeconds ?? 0) / 60),
          ...(showNames ? { employee: e.user.name } : {}),
        })),
      };
    }
    case "HOURS_BY_CATEGORY": {
      const client = await getClient(clientId);
      const entries = await prisma.timeEntry.findMany({
        where: { clientId, deletedAt: null, endAt: { not: null }, startAt: { gte: from, lt: to } },
        include: { category: true },
      });
      const byCategory = new Map<string, number>();
      for (const e of entries) {
        byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? 0) + Math.round((e.billableSeconds ?? 0) / 60));
      }
      return { reportType, client: client?.name, rows: [...byCategory.entries()].map(([category, minutes]) => ({ category, minutes })) };
    }
  }
}

function renderEmailBody(reportType: ClientReportType, clientName: string, from: Date, to: Date, snapshot: any): { subject: string; text: string } {
  const label = REPORT_TYPE_LABELS[reportType];
  // Phase 8 fix: from/to are UTC instants representing LOCAL midnight
  // boundaries (see computeReportingPeriod) - formatting them with
  // toISOString() would show the wrong calendar date for the same reason
  // documented in lib/timezone.ts, so this labels them via localDateKey
  // instead. `to` is an exclusive upper bound (the local day AFTER the
  // period ends); the inclusive last day is computed on the LOCAL Y-M-D
  // numbers (not by subtracting a fixed 24h, which would land on the
  // wrong wall-clock time across a DST transition night) and only then
  // converted back to a Date purely so localDateKey can format it.
  const [toY, toM, toD] = localDateKey(to).split("-").map(Number);
  const inclusiveTo = new Date(Date.UTC(toY, toM - 1, toD - 1));
  const period = `${localDateKey(from)} - ${localDateKey(inclusiveTo, "UTC")}`;
  const subject = `Ankora - ${label} - ${clientName} (${period})`;

  const lines = [`${label} עבור ${clientName}`, `תקופה: ${period}`, ""];
  if (reportType === "HOUR_BANK_STATUS") {
    const cycle = snapshot.cycle;
    if (cycle) {
      lines.push(`נרכשו: ${cycle.purchasedMinutes} דקות`, `נוצל (מטמון): ${cycle.consumedMinutes} דקות`, `סטטוס מחזור: ${cycle.status}`);
    } else {
      lines.push("אין מחזור פעיל בתקופה זו.");
    }
  } else if (reportType === "HOURS_BY_CATEGORY") {
    for (const row of snapshot.rows) lines.push(`${row.category}: ${row.minutes} דקות`);
  } else {
    lines.push(`סה"כ שורות: ${snapshot.rows.length}`);
    for (const row of snapshot.rows.slice(0, 20)) {
      lines.push(`${row.date} | ${row.activity} | ${row.category} | ${row.billableMinutes} דק'${row.employee ? " | " + row.employee : ""}`);
    }
    if (snapshot.rows.length > 20) lines.push(`... ועוד ${snapshot.rows.length - 20} שורות (ראו את פורטל הלקוח לפרטים המלאים).`);
  }
  lines.push("", "לצפייה מלאה: https://www.ankora.co.il/app/portal");

  return { subject, text: lines.join("\n") };
}

/// The one send path both the cron and "send now" go through. `persist`
/// controls whether this counts as an OFFICIAL scheduled send (creates a
/// ReportRun + advances lastSentAt) or a test send (spec 15: "אפשר Send
/// now מתוך Admin לצורך בדיקה" - a test must never masquerade as having
/// actually fulfilled the schedule for that period, so it skips both).
export async function sendReportSchedule(
  schedule: ReportSchedule,
  period: { from: Date; to: Date },
  persist: boolean
): Promise<{ sent: boolean; reason?: string }> {
  if (schedule.recipients.length === 0) {
    return { sent: false, reason: "No recipients configured" };
  }

  if (persist) {
    const existing = await prisma.reportRun.findUnique({
      where: { scheduleId_periodStart: { scheduleId: schedule.id, periodStart: period.from } },
    });
    if (existing) return { sent: false, reason: "Already sent for this period" };
  }

  const client = await getClient(schedule.clientId);
  if (!client) return { sent: false, reason: "Client not found" };

  const snapshot = await buildSnapshot(schedule.clientId, schedule.reportType, period.from, period.to);
  const { subject, text } = renderEmailBody(schedule.reportType, client.name, period.from, period.to, snapshot);

  const result = await sendEmail({ to: schedule.recipients, subject, text });

  let reportRunId: string | null = null;
  if (persist) {
    const run = await prisma.reportRun.create({
      data: {
        scheduleId: schedule.id,
        periodStart: period.from,
        periodEnd: period.to,
        snapshotJson: snapshot,
      },
    });
    reportRunId = run.id;
  }

  await prisma.emailDelivery.create({
    data: {
      reportRunId,
      template: persist ? `report.${schedule.reportType.toLowerCase()}` : `report.${schedule.reportType.toLowerCase()}.test`,
      recipients: schedule.recipients,
      status: result.ok ? "SENT" : "FAILED",
      providerMessageId: result.providerMessageId,
      error: result.error,
    },
  });

  if (persist && result.ok) {
    await prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastSentAt: new Date() } });
  }

  if (persist) {
    // No human actor for a cron-triggered send (actorId: null) - the
    // "send now" manual test path goes through sendReportScheduleNow's
    // assertCan check but never calls persist=true itself, so this audit
    // event is always the system, never a specific admin.
    await recordAudit({
      actorId: null,
      action: "report_schedule.sent",
      entityType: "ReportSchedule",
      entityId: schedule.id,
      clientId: schedule.clientId,
      after: { reportRunId, ok: result.ok },
    });
  }

  return { sent: result.ok, reason: result.error };
}

/// Called by the daily cron (app/api/cron/scheduled-reports/route.ts) -
/// finds every enabled schedule due right now and sends it.
export async function reconcileScheduledReports(now: Date = new Date()) {
  const schedules = await prisma.reportSchedule.findMany({ where: { enabled: true } });
  let sent = 0;
  let skipped = 0;

  for (const schedule of schedules) {
    if (!isScheduleDue(schedule, now)) {
      skipped++;
      continue;
    }
    const period = computeReportingPeriod(schedule.frequency, now, schedule.timezone);
    const result = await sendReportSchedule(schedule, period, true);
    if (result.sent) sent++;
    else skipped++;
  }

  return { checked: schedules.length, sent, skipped };
}

/// Spec 15: "אפשר Send now מתוך Admin לצורך בדיקה." Sends the most recent
/// complete period's report as a one-off test - never persisted as a
/// ReportRun, never advances lastSentAt (see sendReportSchedule's
/// `persist` param doc comment).
export async function sendReportScheduleNow(actor: User, scheduleId: string) {
  assertCan(actor.role, "report.internal.view");

  const schedule = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
  const period = computeReportingPeriod(schedule.frequency, new Date(), schedule.timezone);
  return sendReportSchedule(schedule, period, false);
}

/// CSV export for the client portal's Monthly Detailed screen (the one
/// client-facing export spec 14.4 requires: "CSV חובה... עברית חייבת
/// להישאר קריאה"). Reused here rather than duplicated so the portal
/// screen and its export can never disagree, same pattern as Phase 5's
/// runReport/export route pairing.
export function monthlyDetailedToCsv(rows: { date: string; activity: string; category: string; billableMinutes: number; employee?: string }[]): string {
  const showEmployee = rows.some((r) => r.employee !== undefined);
  const headers = showEmployee
    ? ["תאריך", "פעילות", "קטגוריה", "דקות לחיוב", "עובד"]
    : ["תאריך", "פעילות", "קטגוריה", "דקות לחיוב"];
  const body = rows.map((r) =>
    showEmployee
      ? [r.date, r.activity, r.category, r.billableMinutes, r.employee ?? ""]
      : [r.date, r.activity, r.category, r.billableMinutes]
  );
  return toCsv(headers, body);
}
