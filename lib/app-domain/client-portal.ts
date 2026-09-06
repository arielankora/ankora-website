import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, ForbiddenError } from "@/lib/app-auth/permissions";
import { getCurrentHourBank, listHourBanksForClient } from "@/lib/app-domain/hour-banks";
import { getClient } from "@/lib/app-domain/clients";
import { localDateKey, localDateTimeToUtc } from "@/lib/timezone";
import type { User, Client, ClientUserRole } from "@prisma/client";

// Phase 6 domain service: spec section 13 ("Client Portal"). Every function
// here is deliberately client-isolated by construction rather than by
// caller discipline: resolvePortalClient() is the ONLY way in, it derives
// the caller's own clientId from their ClientUser membership (never from a
// caller-supplied parameter), and every other function in this file takes
// that resolved clientId as an internal implementation detail - there is
// no "pass any clientId you like" entry point a compromised/buggy caller
// could misuse to read another client's data (spec 21.2's "Client user של
// לקוח X לא יכול לשנות URL/ID ולקבל נתוני Y").
//
// Spec 13's own exclusion list is enforced structurally, not just by
// omission: these functions never select TimeEntry.note (internal
// free-text - spec 13: "אין גישה ל... internal notes"), never select
// actualSeconds (spec 25: "Client report basis: Billable time" - only
// billableSeconds ever reaches a portal screen), never join
// TimeEntryRevision/AuditEvent, and the activity/description shown per
// entry is always the linked Task's title (or the category name if there
// is no task) - never the entry's own note field. This is a deliberate,
// documented interpretation of an otherwise-silent point: spec 6.1 lets a
// TimeEntry's "note" hold free text a client should never see, while Task
// titles are the client-facing description spec 13's "Weekly activity:
// משימות שבוצעו" / "Monthly detailed report: date, task, category..."
// literally asks for.

export interface PortalClientContext {
  client: Client;
  clientUserId: string;
  clientUserRole: ClientUserRole;
}

/// The one and only way any Phase 6 function learns which client a
/// CLIENT_USER belongs to. A CLIENT_USER is modeled (schema.prisma) as
/// potentially holding multiple ClientUser memberships, but nothing in
/// spec section 13 describes a multi-client portal switcher - the MVP
/// assumption (documented in the ADR addendum) is one portal user -> one
/// client, so this takes the first membership. If Ankora ever actually
/// needs a single login spanning multiple clients, that is a deliberate
/// future change, not an oversight.
export async function resolvePortalClient(actor: User): Promise<PortalClientContext> {
  assertCan(actor.role, "report.client.view");

  const membership = await prisma.clientUser.findFirst({
    where: { userId: actor.id },
    include: { client: true },
    orderBy: { createdAt: "asc" },
  });

  if (!membership || membership.client.deletedAt) {
    throw new ForbiddenError("No active client membership for this portal user");
  }

  return { client: membership.client, clientUserId: membership.id, clientUserRole: membership.role };
}

// Phase 8 fix (docs/adr/0001, Phase 8 addendum section 15.3): these four
// used to compute week/month boundaries from `d`'s UTC calendar fields
// (getUTCDay()/getUTCDate()/getUTCFullYear()/getUTCMonth()) - wrong for a
// portal whose default timezone is Asia/Jerusalem (spec section 0/25):
// near a week/month boundary, Israel's calendar and UTC's can disagree on
// what day it is (Israel is ahead by +2/+3 hours), so "today" as seen by
// an Ankora/client user opening the portal could silently fall in the
// PREVIOUS UTC week/month, showing last week's data under "this week."
// Same root cause and fix as report-schedules.ts's computeReportingPeriod
// (that function's own comment has the full explanation) - both now go
// through localDateKey/localDateTimeToUtc.

function startOfWeek(d: Date): Date {
  // Spec default timezone Asia/Jerusalem's week starts Sunday (spec 15's
  // own weekly-report example: "יום א׳ בבוקר עבור השבוע הקודם").
  const [y, m, day] = localDateKey(d).split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // weekday of a calendar date is tz-independent
  const startLocal = new Date(Date.UTC(y, m - 1, day - weekday));
  return localDateTimeToUtc(startLocal.toISOString().slice(0, 10), "00:00");
}

function endOfWeek(start: Date): Date {
  const [y, m, day] = localDateKey(start).split("-").map(Number);
  const endLocal = new Date(Date.UTC(y, m - 1, day + 7));
  return localDateTimeToUtc(endLocal.toISOString().slice(0, 10), "00:00");
}

function startOfMonth(d: Date): Date {
  const [y, m] = localDateKey(d).split("-").map(Number);
  const startLocal = new Date(Date.UTC(y, m - 1, 1));
  return localDateTimeToUtc(startLocal.toISOString().slice(0, 10), "00:00");
}

function endOfMonth(start: Date): Date {
  const [y, m] = localDateKey(start).split("-").map(Number);
  const endLocal = new Date(Date.UTC(y, m, 1));
  return localDateTimeToUtc(endLocal.toISOString().slice(0, 10), "00:00");
}

function round(n: number): number {
  return Math.round(n);
}

function toMinutes(seconds: number | null | undefined): number {
  return round((seconds ?? 0) / 60);
}

/// Spec 13's Dashboard: "בנק שעות נוכחי, נוצל, נותר, % ניצול, ימים עד סוף
/// cycle." Reuses the exact same live snapshot the internal Hour Banks /
/// Reports screens trust (lib/app-domain/hour-banks.ts) - a client must
/// never see a number that doesn't match what Ankora itself sees for the
/// same cycle.
export async function getPortalDashboard(actor: User) {
  const { client } = await resolvePortalClient(actor);
  const snapshot = await getCurrentHourBank(client.id);

  const daysUntilCycleEnd = snapshot
    ? Math.max(0, Math.ceil((snapshot.bank.cycleEnd.getTime() - Date.now()) / 86_400_000))
    : null;

  return {
    client: { name: client.name, timezone: client.timezone },
    snapshot,
    daysUntilCycleEnd,
  };
}

interface PortalEntryRow {
  date: string;
  activity: string;
  category: string;
  billableMinutes: number;
  employee?: string;
}

async function fetchPortalEntries(clientId: string, from: Date, to: Date, showEmployeeNames: boolean) {
  const entries = await prisma.timeEntry.findMany({
    where: { clientId, deletedAt: null, endAt: { not: null }, startAt: { gte: from, lt: to } },
    orderBy: { startAt: "asc" },
    include: { category: true, task: true, user: true },
  });

  return entries.map((e): PortalEntryRow => {
    const row: PortalEntryRow = {
      date: localDateKey(e.startAt), // Phase 8 fix: was UTC-date via toISOString(), wrong near Israel midnight
      activity: e.task?.title ?? e.category.name,
      category: e.category.name,
      billableMinutes: toMinutes(e.billableSeconds),
    };
    if (showEmployeeNames) row.employee = e.user.name;
    return row;
  });
}

/// Spec 13's Weekly Activity: "משימות שבוצעו, שעות לפי משימה/קטגוריה,
/// עובדים לפי הגדרת privacy." weekStart defaults to the current week;
/// callers (the portal screen) can page backward via the same param.
export async function getWeeklyActivity(actor: User, weekStart?: Date) {
  const { client } = await resolvePortalClient(actor);
  const from = startOfWeek(weekStart ?? new Date());
  const to = endOfWeek(from);

  const rows = await fetchPortalEntries(client.id, from, to, client.portalShowEmployeeNames);
  const totalMinutes = rows.reduce((s, r) => s + r.billableMinutes, 0);

  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.billableMinutes);

  return {
    from,
    to,
    rows,
    totalMinutes,
    byCategory: [...byCategory.entries()].map(([category, minutes]) => ({ category, minutes })),
    showEmployeeNames: client.portalShowEmployeeNames,
  };
}

/// Spec 13's Monthly Detailed report / spec 14.1's "Monthly Detailed" row:
/// "שורה לכל Entry/Task: תאריך, משימה, קטגוריה, זמן לחיוב, סיכומים."
/// monthStart defaults to the current calendar month.
export async function getMonthlyDetailed(actor: User, monthStart?: Date) {
  const { client } = await resolvePortalClient(actor);
  const from = startOfMonth(monthStart ?? new Date());
  const to = endOfMonth(from);

  const rows = await fetchPortalEntries(client.id, from, to, client.portalShowEmployeeNames);
  const totalMinutes = rows.reduce((s, r) => s + r.billableMinutes, 0);

  return { from, to, rows, totalMinutes, showEmployeeNames: client.portalShowEmployeeNames };
}

/// Spec 13's Category Summary: "hours + % of total."
export async function getCategorySummary(actor: User, from?: Date, to?: Date) {
  const { client } = await resolvePortalClient(actor);
  const rangeFrom = from ?? startOfMonth(new Date());
  const rangeTo = to ?? endOfMonth(rangeFrom);

  const entries = await prisma.timeEntry.findMany({
    where: { clientId: client.id, deletedAt: null, endAt: { not: null }, startAt: { gte: rangeFrom, lt: rangeTo } },
    include: { category: true },
  });

  const byCategory = new Map<string, number>();
  for (const e of entries) {
    byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? 0) + toMinutes(e.billableSeconds));
  }
  const total = [...byCategory.values()].reduce((s, m) => s + m, 0);

  const rows = [...byCategory.entries()]
    .map(([category, minutes]) => ({
      category,
      minutes,
      pctOfTotal: total > 0 ? round((minutes / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  return { from: rangeFrom, to: rangeTo, rows, totalMinutes: total };
}

/// Spec 13's History: "cycles קודמים ודוחות." Reuses the same
/// listHourBanksForClient the internal Hour Banks screen already trusts
/// (newest first, each with a live-recomputed snapshot) plus the client's
/// own sent ReportRun history, so "cycles" and "דוחות" (reports) both
/// literally appear per the spec's own two nouns.
export async function getPortalHistory(actor: User) {
  const { client, clientUserRole } = await resolvePortalClient(actor);

  const [cycles, runs, schedules] = await Promise.all([
    listHourBanksForClient(client.id),
    prisma.reportRun.findMany({
      where: { schedule: { clientId: client.id } },
      orderBy: { periodStart: "desc" },
      take: 50,
      include: { schedule: true },
    }),
    prisma.reportSchedule.findMany({
      where: { clientId: client.id },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    cycles: cycles.map((c) => ({
      cycleStart: c.bank.cycleStart,
      cycleEnd: c.bank.cycleEnd,
      status: c.bank.status,
      utilizationPct: c.utilization.utilizationPct,
      consumedMinutes: c.utilization.consumedMinutes,
      totalMinutes: c.utilization.totalMinutes,
    })),
    reportRuns: runs.map((r) => ({
      id: r.id,
      reportType: r.schedule.reportType,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      sentAt: r.createdAt,
    })),
    // Spec 13: "Client Admin יכול לנהל recipients... אם Ankora מאפשרת" -
    // surfaced here (rather than a separate function) since History is
    // already the one portal screen that looks at ReportSchedule/ReportRun
    // data; canManageRecipients tells the screen whether to render the
    // editing form at all (see updatePortalScheduleRecipients below for
    // the actual write-path permission check, which is re-verified
    // server-side regardless of what this flag says).
    schedules: schedules.map((s) => ({
      id: s.id,
      reportType: s.reportType,
      frequency: s.frequency,
      recipients: s.recipients,
      enabled: s.enabled,
    })),
    canManageRecipients: clientUserRole === "ADMIN",
  };
}

/// Spec 13: "Client Admin יכול לנהל recipients לדוחות/alerts אם Ankora
/// מאפשרת." Interpreted (see ADR addendum) as: Ankora "allows" this by
/// assigning the portal user ClientUserRole=ADMIN rather than VIEWER (the
/// existing spec-4 distinction) - no separate per-client toggle is
/// invented for what the spec itself already models as two roles. A
/// Client Admin may only edit the recipients array of schedules
/// belonging to their OWN client (never report type/frequency/enabled -
/// those stay an Ankora-only decision via report.internal.view).
export async function updatePortalScheduleRecipients(actor: User, scheduleId: string, recipients: string[]) {
  const { client, clientUserRole } = await resolvePortalClient(actor);
  if (clientUserRole !== "ADMIN") {
    throw new ForbiddenError("Only a Client Admin may edit report recipients");
  }

  const schedule = await prisma.reportSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule || schedule.clientId !== client.id) {
    throw new ForbiddenError("Schedule does not belong to this client");
  }

  const cleaned = recipients.map((r) => r.trim().toLowerCase()).filter(Boolean);
  return prisma.reportSchedule.update({ where: { id: scheduleId }, data: { recipients: cleaned } });
}
