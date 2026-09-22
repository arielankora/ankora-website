import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { assertCan, can, ForbiddenError } from "@/lib/app-auth/permissions";
import { getCurrentHourBank, listHourBanksForClient } from "@/lib/app-domain/hour-banks";
import { getClient } from "@/lib/app-domain/clients";
import { normalizeEmails } from "@/lib/app-domain/report-schedules";
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

export interface PortalMembership {
  clientId: string;
  clientName: string;
}

export interface PortalClientContext {
  client: Client;
  /// Null in a staff preview: nobody's membership is being used, so there
  /// is no ClientUser row to attribute a write to. Every write path in
  /// this file refuses when this is null (see assertPortalWritable).
  clientUserId: string | null;
  clientUserRole: ClientUserRole;
  /// Portal phase 0: an Ankora manager looking at what a client sees.
  /// Read-only by construction, never a client's own session.
  isStaffPreview: boolean;
  /// Every client this portal user belongs to, for the switcher. One entry
  /// for the common case, empty in a staff preview.
  memberships: PortalMembership[];
}

/// Portal phase 0. Which client the portal should resolve to is a
/// per-request choice that lives in a cookie rather than in the URL: the
/// portal is four screens plus an export route, and threading a query
/// parameter through all of them (and through every internal link) would
/// give five more places to forget it - and one forgotten place is a
/// client looking at the wrong client's hours.
///
/// The cookie is a REQUEST, never an authorisation: both values below are
/// re-checked against the caller's own memberships (or their staff
/// permission) on every single call, so a hand-edited cookie can only
/// ever fail closed.
export const PORTAL_CLIENT_COOKIE = "ank_portal_client";
export const PORTAL_PREVIEW_COOKIE = "ank_portal_preview";

/// Reading cookies needs a request scope. The integration tests call the
/// domain functions directly, with no request around them, and they
/// should keep passing without a fake one - so a missing scope simply
/// means "no selection", which is the pre-phase-0 behaviour.
async function portalSelection(): Promise<{ selected?: string; preview?: string }> {
  try {
    const jar = await cookies();
    return {
      selected: jar.get(PORTAL_CLIENT_COOKIE)?.value || undefined,
      preview: jar.get(PORTAL_PREVIEW_COOKIE)?.value || undefined,
    };
  } catch {
    return {};
  }
}

/// The one guard every portal write must pass. A staff preview may read
/// everything the client reads and change nothing, which is the whole
/// point of it: a manager checking what a client sees must never be able
/// to act as that client, and the audit trail must never show a write
/// that no client actually made.
export function assertPortalWritable(ctx: PortalClientContext) {
  if (ctx.isStaffPreview || !ctx.clientUserId) {
    throw new ForbiddenError("Portal preview is read-only");
  }
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
  const { selected, preview } = await portalSelection();

  // Staff preview first: an Ankora manager has no ClientUser row at all,
  // so without this branch they would always be rejected below. Gated on
  // report.internal.view, the permission that already lets Super Admin and
  // Ankora Admin read any client's hours on the internal reports screens -
  // so the preview never widens what anyone can see, it only changes how
  // it is presented. An ANKORA_EMPLOYEE has neither that permission nor a
  // membership, and is refused exactly as before.
  if (preview && can(actor.role, "report.internal.view")) {
    const client = await prisma.client.findFirst({ where: { id: preview, deletedAt: null } });
    if (!client) throw new ForbiddenError("Unknown client for portal preview");
    return {
      client,
      clientUserId: null,
      // VIEWER on purpose: Client-Admin-only surfaces (the scheduled-report
      // recipients panel) stay hidden in a preview rather than rendering a
      // form that would refuse on submit.
      clientUserRole: "VIEWER",
      isStaffPreview: true,
      memberships: [],
    };
  }

  assertCan(actor.role, "report.client.view");

  const memberships = await prisma.clientUser.findMany({
    where: { userId: actor.id },
    include: { client: true },
    orderBy: { createdAt: "asc" },
  });
  const usable = memberships.filter((m) => !m.client.deletedAt);

  if (usable.length === 0) {
    throw new ForbiddenError("No active client membership for this portal user");
  }

  // Portal phase 0: a portal user may hold several memberships (a founder
  // who is also a private client, a family with two entities). Before
  // this, the first membership won permanently and the others were
  // unreachable. The cookie only ever picks FROM this list, so it cannot
  // reach a client the user does not belong to.
  const chosen = usable.find((m) => m.clientId === selected) ?? usable[0];

  return {
    client: chosen.client,
    clientUserId: chosen.id,
    clientUserRole: chosen.role,
    isStaffPreview: false,
    memberships: usable.map((m) => ({ clientId: m.clientId, clientName: m.client.name })),
  };
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

/// App redesign (handoff README, screen 16 "פעילות שבועית"): the
/// prototype's weekly tab is a 7-bar chart (Sun-Sat) plus a "מה נעשה
/// השבוע" list. Both are real aggregates of the same rows fetchPortalEntries
/// already returns - no new query, just grouped two ways: dailyTotals by
/// calendar day (for the bars) and topActivities by activity title (for
/// the list). The prototype's list shows invented per-line narrative
/// ("הושלם מול הסוכן", "ממתין לאישור תאריכים") - there is no such status
/// detail on a TimeEntry or its linked Task in this schema, so that's
/// deliberately not reproduced; the real substitute is each activity's
/// total billable time, sorted by size, which is honest to what the data
/// actually holds.
function dailyTotals(rows: PortalEntryRow[], from: Date) {
  const [y, m, day] = localDateKey(from).split("-").map(Number);
  const dayKeys = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, day + i)).toISOString().slice(0, 10));
  return dayKeys.map((date) => ({
    date,
    minutes: rows.filter((r) => r.date === date).reduce((s, r) => s + r.billableMinutes, 0),
  }));
}

function topActivities(rows: PortalEntryRow[], limit = 5) {
  const byActivity = new Map<string, number>();
  for (const r of rows) byActivity.set(r.activity, (byActivity.get(r.activity) ?? 0) + r.billableMinutes);
  return [...byActivity.entries()]
    .map(([activity, minutes]) => ({ activity, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit);
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
    dailyTotals: dailyTotals(rows, from),
    topActivities: topActivities(rows),
    showEmployeeNames: client.portalShowEmployeeNames,
  };
}

/// App redesign (handoff README, screen 16 "דוח חודשי"): the prototype
/// shows three KPI tiles (hours, tasks completed, "suppliers coordinated")
/// plus a prose "case manager summary" and an auto-send date. This schema
/// has no supplier concept and no free-text per-cycle manager summary
/// field anywhere (Client/HourBankCycle/ReportSchedule all checked) - both
/// are decorative flourishes from the prototype's fictional example
/// client, not real capabilities, so neither is reproduced (same judgment
/// call as Phase 5's alerts panel dropping "snooze"/the long-timer card).
/// tasksCompletedCount is real: Task.status=DONE has existed since Phase
/// 10, updatedAt inside the period is the closest real proxy for "done
/// this month" this schema offers (there's no separate completedAt
/// column). nextAutoSendLabel is also real: the client's own enabled
/// MONTHLY_DETAILED ReportSchedule, if one exists.
async function tasksCompletedCount(clientId: string, from: Date, to: Date) {
  return prisma.task.count({
    where: { clientId, status: "DONE", deletedAt: null, updatedAt: { gte: from, lt: to } },
  });
}

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

async function nextAutoSendLabel(clientId: string): Promise<string | null> {
  const schedule = await prisma.reportSchedule.findFirst({
    where: { clientId, reportType: "MONTHLY_DETAILED", enabled: true },
    orderBy: { createdAt: "asc" },
  });
  if (!schedule) return null;
  if (schedule.frequency === "WEEKLY") return `נשלח אוטומטית כל שבוע ביום ${WEEKDAY_LABELS[schedule.dayOfWeek ?? 0]}`;
  return `נשלח אוטומטית ב-${schedule.dayOfMonth ?? 1} לכל חודש`;
}

/// Spec 13's Monthly Detailed report / spec 14.1's "Monthly Detailed" row:
/// "שורה לכל Entry/Task: תאריך, משימה, קטגוריה, זמן לחיוב, סיכומים."
/// monthStart defaults to the current calendar month.
export async function getMonthlyDetailed(actor: User, monthStart?: Date) {
  const { client } = await resolvePortalClient(actor);
  const from = startOfMonth(monthStart ?? new Date());
  const to = endOfMonth(from);

  const [rows, tasksCompleted, autoSendLabel] = await Promise.all([
    fetchPortalEntries(client.id, from, to, client.portalShowEmployeeNames),
    tasksCompletedCount(client.id, from, to),
    nextAutoSendLabel(client.id),
  ]);
  const totalMinutes = rows.reduce((s, r) => s + r.billableMinutes, 0);

  return {
    from,
    to,
    rows,
    totalMinutes,
    tasksCompleted,
    autoSendLabel,
    showEmployeeNames: client.portalShowEmployeeNames,
  };
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
  const ctx = await resolvePortalClient(actor);
  const { client, clientUserRole } = ctx;
  // Portal phase 0: a staff preview reaches this function with a resolved
  // client and no membership. It must never write - see
  // assertPortalWritable. The role check below would already refuse
  // today (a preview resolves as VIEWER), but relying on that would make
  // the read-only guarantee an accident of one constant.
  assertPortalWritable(ctx);
  if (clientUserRole !== "ADMIN") {
    throw new ForbiddenError("Only a Client Admin may edit report recipients");
  }

  const schedule = await prisma.reportSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule || schedule.clientId !== client.id) {
    throw new ForbiddenError("Schedule does not belong to this client");
  }

  // Overnight bug-hunt (docs/adr/0001 section 19.6): use the same
  // normalizeEmails() the Ankora-side ReportSchedule CRUD already uses
  // (report-schedules.ts) instead of a separate, slightly weaker inline
  // clean here - this path was missing the de-duplication half, so a
  // Client Admin pasting the same address twice (or an address already
  // present plus a re-typed duplicate) would have every scheduled email
  // sent to that address twice going forward.
  const cleaned = normalizeEmails(recipients);
  return prisma.reportSchedule.update({ where: { id: scheduleId }, data: { recipients: cleaned } });
}
