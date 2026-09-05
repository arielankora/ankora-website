import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { getCurrentHourBank } from "@/lib/app-domain/hour-banks";
import { listClients } from "@/lib/app-domain/clients";
import { listAlertRulesForClient } from "@/lib/app-domain/alerts";
import type { User, TimeEntrySource } from "@prisma/client";

// Phase 5 domain service: spec section 14 ("דוחות ודשבורדים"), specifically
// 14.2's nine internal report types and 14.3's filter set. Spec section 23
// scopes Phase 5 to "Internal dashboards + reports + exports" - client-
// facing reports (14.1, spec section 13's Client Portal) remain out of
// scope until Phase 6, per the ADR addendum for this phase.
//
// No new Prisma models were needed for this phase - every report here is a
// read-only aggregation over TimeEntry/HourBank/AlertRule data that Phases
// 1-4 already persist (ReportSchedule, the one report-related model spec
// section 5 lists, is Phase 6 territory: it exists to persist a *recurring
// email schedule*, which this phase does not build - see spec section 15
// and the ADR addendum).
//
// Every function here re-derives its numbers from raw TimeEntry rows (or
// the same live HourBank snapshot the Hour Banks screen already trusts) -
// never from a client-supplied number - per spec 5.1's "כל חישוב aggregate
// מבוסס על server-side canonical values" and 21.2's required test "Report
// aggregates equal raw time entry sums."

export type ReportType =
  | "total_client_hours"
  | "hours_by_employee"
  | "hours_by_client"
  | "hours_by_category"
  | "employee_client_matrix"
  | "manual_edits"
  | "overage_at_risk"
  | "active_timers"
  | "capacity";

/// Spec 14.2's own table, used verbatim for labels/order.
export const REPORT_DEFINITIONS: { id: ReportType; label: string; usage: string }[] = [
  { id: "total_client_hours", label: "סה\"כ שעות לקוחות", usage: "כל הלקוחות בתקופה; בפועל/לחיוב" },
  { id: "hours_by_employee", label: "שעות לפי עובד", usage: "עובד, בפועל, לחיוב, מספר לקוחות" },
  { id: "hours_by_client", label: "שעות לפי לקוח", usage: "לקוח, נוצל, נותר, אחוז ניצול" },
  { id: "hours_by_category", label: "שעות לפי קטגוריה", usage: "פילוח לפי קטגוריה, רוחבי או ללקוח נבחר" },
  { id: "employee_client_matrix", label: "מטריצת עובדים מול לקוחות", usage: "מי עבד כמה עבור כל לקוח" },
  { id: "manual_edits", label: "דיווחים ידניים/ערוכים", usage: "entries ידניים/ערוכים + מבצע + סיבה" },
  { id: "overage_at_risk", label: "חריגה / בסיכון", usage: "לקוחות מעל סף או קרובים אליו" },
  { id: "active_timers", label: "טיימרים פעילים", usage: "טיימרים פעילים וזמן ריצה נוכחי" },
  { id: "capacity", label: "קיבולת עובדים", usage: "שעות עובד בתקופה + חלוקה ללקוחות" },
];

export interface ReportFilters {
  from?: Date;
  to?: Date;
  clientId?: string;
  userId?: string;
  categoryId?: string;
  source?: TimeEntrySource;
  /// Spec 14.3's "edited/manual" filter, split into two independent flags
  /// rather than one enum - an entry can be manual AND later edited, so a
  /// single mutually-exclusive selector would misrepresent that overlap.
  editedOnly?: boolean;
  manualOnly?: boolean;
}

export interface ReportColumn {
  key: string;
  label: string;
  /// CSV/number formatting hint - "minutes" columns are rendered as
  /// H:MM in the UI table but exported as raw integer minutes in CSV
  /// (spec 21's storage convention: never float hours).
  type?: "text" | "minutes" | "percent" | "number";
}

export interface ReportResult {
  type: ReportType;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
}

function round(n: number): number {
  return Math.round(n);
}

function toMinutes(seconds: number | null | undefined): number {
  return round((seconds ?? 0) / 60);
}

/// Shared base query every per-entry report filters through. Deliberately
/// excludes currently-running timers (endAt = null) - those have no
/// actual/billableSeconds yet and are covered separately by the
/// "Active Timers" report, matching spec 14.2's own split between the two
/// report rows.
async function fetchEntries(filters: ReportFilters) {
  return prisma.timeEntry.findMany({
    where: {
      deletedAt: null,
      endAt: { not: null },
      clientId: filters.clientId,
      userId: filters.userId,
      categoryId: filters.categoryId,
      source: filters.source,
      isEdited: filters.editedOnly ? true : undefined,
      isManual: filters.manualOnly ? true : undefined,
      startAt: { gte: filters.from, lte: filters.to },
    },
    orderBy: { startAt: "desc" },
    include: {
      client: true,
      category: true,
      user: true,
      revisions: { orderBy: { version: "desc" }, take: 1, include: { changedBy: true } },
    },
  });
}

/// Spec 14.2 row 1: "Total Client Hours | כל הלקוחות בתקופה; actual/billable."
/// A single summary row over whatever scope the filters select (all clients
/// by default, or one client if filtered) - the report name and terse spec
/// description read as an overall total, not a per-client breakdown (that's
/// "Hours by Client" below).
async function totalClientHours(filters: ReportFilters): Promise<ReportResult> {
  const entries = await fetchEntries(filters);
  const actualSeconds = entries.reduce((sum, e) => sum + (e.actualSeconds ?? 0), 0);
  const billableSeconds = entries.reduce((sum, e) => sum + (e.billableSeconds ?? 0), 0);
  const distinctClients = new Set(entries.map((e) => e.clientId)).size;

  return {
    type: "total_client_hours",
    title: "סה\"כ שעות לקוחות",
    columns: [
      { key: "entryCount", label: "מספר דיווחים", type: "number" },
      { key: "clientCount", label: "מספר לקוחות", type: "number" },
      { key: "actualMinutes", label: "בפועל", type: "minutes" },
      { key: "billableMinutes", label: "לחיוב", type: "minutes" },
    ],
    rows: [
      {
        entryCount: entries.length,
        clientCount: distinctClients,
        actualMinutes: toMinutes(actualSeconds),
        billableMinutes: toMinutes(billableSeconds),
      },
    ],
  };
}

/// Spec 14.2 row 2: "Hours by Employee | עובד, actual, billable, clients count."
async function hoursByEmployee(filters: ReportFilters): Promise<ReportResult> {
  const entries = await fetchEntries(filters);
  const byUser = new Map<
    string,
    { userName: string; actualSeconds: number; billableSeconds: number; clients: Set<string> }
  >();

  for (const e of entries) {
    const row = byUser.get(e.userId) ?? {
      userName: e.user.name,
      actualSeconds: 0,
      billableSeconds: 0,
      clients: new Set<string>(),
    };
    row.actualSeconds += e.actualSeconds ?? 0;
    row.billableSeconds += e.billableSeconds ?? 0;
    row.clients.add(e.clientId);
    byUser.set(e.userId, row);
  }

  const rows = [...byUser.values()]
    .map((r) => ({
      employee: r.userName,
      actualMinutes: toMinutes(r.actualSeconds),
      billableMinutes: toMinutes(r.billableSeconds),
      clientCount: r.clients.size,
    }))
    .sort((a, b) => b.billableMinutes - a.billableMinutes);

  return {
    type: "hours_by_employee",
    title: "שעות לפי עובד",
    columns: [
      { key: "employee", label: "עובד" },
      { key: "actualMinutes", label: "בפועל", type: "minutes" },
      { key: "billableMinutes", label: "לחיוב", type: "minutes" },
      { key: "clientCount", label: "מספר לקוחות", type: "number" },
    ],
    rows,
  };
}

/// Spec 14.2 row 3: "Hours by Client | לקוח, used, remaining, utilization."
/// Deliberately reads the LIVE current-cycle Hour Bank snapshot (the same
/// one lib/app-domain/hour-banks.ts's getCurrentHourBank computes for the
/// Hour Banks screen) rather than re-deriving used/remaining/utilization
/// from the report's own date-range filter - "used/remaining/utilization"
/// are inherently cycle-scoped concepts (spec 8.3), not period-scoped ones,
/// so applying an arbitrary from/to range to them would produce numbers
/// that don't match the Hour Banks screen an admin would cross-check
/// against. Documented as a deliberate choice in the ADR addendum.
async function hoursByClient(filters: ReportFilters): Promise<ReportResult> {
  const clients = filters.clientId
    ? (await listClients()).filter((c) => c.id === filters.clientId)
    : (await listClients()).filter((c) => c.status === "ACTIVE");

  const rows = (
    await Promise.all(
      clients.map(async (client) => {
        const snapshot = await getCurrentHourBank(client.id);
        if (!snapshot) return null;
        return {
          client: client.name,
          usedMinutes: snapshot.utilization.consumedMinutes,
          remainingMinutes: snapshot.utilization.remainingMinutes,
          utilizationPct: snapshot.utilization.utilizationPct,
        };
      })
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null);

  return {
    type: "hours_by_client",
    title: "שעות לפי לקוח",
    columns: [
      { key: "client", label: "לקוח" },
      { key: "usedMinutes", label: "נוצל", type: "minutes" },
      { key: "remainingMinutes", label: "נותר", type: "minutes" },
      { key: "utilizationPct", label: "אחוז ניצול", type: "percent" },
    ],
    rows,
  };
}

/// Spec 14.2 row 4: "Hours by Category | פילוח רוחבי או per client."
/// Groups by category across whatever client scope the filters select -
/// passing clientId narrows it to that one client's own category split
/// ("per client"); omitting it gives the cross-client ("רוחבי") split.
async function hoursByCategory(filters: ReportFilters): Promise<ReportResult> {
  const entries = await fetchEntries(filters);
  const byCategory = new Map<string, { categoryName: string; actualSeconds: number; billableSeconds: number }>();

  for (const e of entries) {
    const row = byCategory.get(e.categoryId) ?? {
      categoryName: e.category.name,
      actualSeconds: 0,
      billableSeconds: 0,
    };
    row.actualSeconds += e.actualSeconds ?? 0;
    row.billableSeconds += e.billableSeconds ?? 0;
    byCategory.set(e.categoryId, row);
  }

  const totalBillable = [...byCategory.values()].reduce((s, r) => s + r.billableSeconds, 0);

  const rows = [...byCategory.values()]
    .map((r) => ({
      category: r.categoryName,
      actualMinutes: toMinutes(r.actualSeconds),
      billableMinutes: toMinutes(r.billableSeconds),
      pctOfTotal: totalBillable > 0 ? round((r.billableSeconds / totalBillable) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.billableMinutes - a.billableMinutes);

  return {
    type: "hours_by_category",
    title: "שעות לפי קטגוריה",
    columns: [
      { key: "category", label: "קטגוריה" },
      { key: "actualMinutes", label: "בפועל", type: "minutes" },
      { key: "billableMinutes", label: "לחיוב", type: "minutes" },
      { key: "pctOfTotal", label: "% מהסה\"כ", type: "percent" },
    ],
    rows,
  };
}

/// Spec 14.2 row 5: "Employee x Client Matrix | מי עובד כמה עבור כל לקוח."
/// Flattened as one row per (employee, client) pair with activity in the
/// filtered range, rather than a literal 2D grid - a flat table is what
/// both the on-screen table component and CSV export already render for
/// every other report, and a wide pivoted grid would need a different,
/// one-off UI just for this report. The same underlying data is what
/// "Capacity" below re-shapes per-employee.
async function employeeClientMatrix(filters: ReportFilters): Promise<ReportResult> {
  const entries = await fetchEntries(filters);
  const byPair = new Map<
    string,
    { userName: string; clientName: string; actualSeconds: number; billableSeconds: number }
  >();

  for (const e of entries) {
    const key = `${e.userId}:${e.clientId}`;
    const row = byPair.get(key) ?? {
      userName: e.user.name,
      clientName: e.client.name,
      actualSeconds: 0,
      billableSeconds: 0,
    };
    row.actualSeconds += e.actualSeconds ?? 0;
    row.billableSeconds += e.billableSeconds ?? 0;
    byPair.set(key, row);
  }

  const rows = [...byPair.values()]
    .map((r) => ({
      employee: r.userName,
      client: r.clientName,
      actualMinutes: toMinutes(r.actualSeconds),
      billableMinutes: toMinutes(r.billableSeconds),
    }))
    .sort((a, b) => (a.employee === b.employee ? b.billableMinutes - a.billableMinutes : a.employee.localeCompare(b.employee)));

  return {
    type: "employee_client_matrix",
    title: "מטריצת עובדים מול לקוחות",
    columns: [
      { key: "employee", label: "עובד" },
      { key: "client", label: "לקוח" },
      { key: "actualMinutes", label: "בפועל", type: "minutes" },
      { key: "billableMinutes", label: "לחיוב", type: "minutes" },
    ],
    rows,
  };
}

/// Spec 14.2 row 6: "Manual Edits | entries ידניים/ערוכים + actor + reason."
/// isManual and isEdited are independent flags (spec 6.3/6.4) - an entry
/// created manually is not necessarily ever edited afterward, and an entry
/// created via the timer can later be edited - so this report includes a
/// row for EITHER flag, not just entries that are both.
async function manualEdits(filters: ReportFilters): Promise<ReportResult> {
  const entries = await prisma.timeEntry.findMany({
    where: {
      deletedAt: null,
      clientId: filters.clientId,
      userId: filters.userId,
      categoryId: filters.categoryId,
      startAt: { gte: filters.from, lte: filters.to },
      OR: [{ isManual: true }, { isEdited: true }],
    },
    orderBy: { startAt: "desc" },
    include: {
      client: true,
      category: true,
      user: true,
      revisions: { orderBy: { version: "desc" }, take: 1, include: { changedBy: true } },
    },
  });

  const rows = entries.map((e) => {
    const lastRevision = e.revisions[0];
    return {
      date: e.startAt.toISOString().slice(0, 10),
      employee: e.user.name,
      client: e.client.name,
      category: e.category.name,
      manual: e.isManual ? "כן" : "לא",
      edited: e.isEdited ? "כן" : "לא",
      actor: lastRevision?.changedBy?.name ?? e.user.name,
      reason: lastRevision?.reason ?? "",
    };
  });

  return {
    type: "manual_edits",
    title: "דיווחים ידניים/ערוכים",
    columns: [
      { key: "date", label: "תאריך" },
      { key: "employee", label: "עובד" },
      { key: "client", label: "לקוח" },
      { key: "category", label: "קטגוריה" },
      { key: "manual", label: "ידני" },
      { key: "edited", label: "נערך" },
      { key: "actor", label: "מבצע השינוי האחרון" },
      { key: "reason", label: "סיבה" },
    ],
    rows,
  };
}

/// Default "at risk" cutoff when a client has no UTILIZATION_PCT alert
/// rule of its own to borrow a threshold from - see the ADR addendum for
/// why 80% and why AlertRule is consulted first.
const DEFAULT_AT_RISK_PCT = 80;

export type RiskClassification = "OVERAGE" | "AT_RISK" | "OK";

/// Pure classifier extracted for unit testing (spec 21.1 requires "Alert
/// crossing + dedupe"-style pure-function coverage for exactly this kind
/// of threshold decision; see tests/unit/reports.test.ts). "Overage" =
/// utilization at/over 100% (or literally negative remaining minutes).
/// "At risk" = at/over the given threshold but under 100%. The caller
/// (overageAtRisk below) is responsible for deriving `atRiskThresholdPct`
/// per client before calling this.
export function classifyUtilizationRisk(
  utilizationPct: number,
  remainingMinutes: number,
  atRiskThresholdPct: number
): RiskClassification {
  if (utilizationPct >= 100 || remainingMinutes < 0) return "OVERAGE";
  if (utilizationPct >= atRiskThresholdPct) return "AT_RISK";
  return "OK";
}

/// Spec 14.2 row 7: "Overage / At Risk | לקוחות מעל סף או קרובים אליו."
/// "At risk" needed a concrete cutoff the spec doesn't define - spec 9.1
/// already lets each client define its own UTILIZATION_PCT alert
/// threshold(s) (Phase 4); this report reuses the LOWEST enabled one as
/// the "close to it" cutoff for that client (the earliest warning an
/// admin already configured), falling back to a documented default of
/// 80% for a client with no such rule, rather than inventing a second,
/// disconnected "at risk" concept the spec doesn't separately define.
async function overageAtRisk(filters: ReportFilters): Promise<ReportResult> {
  const clients = filters.clientId
    ? (await listClients()).filter((c) => c.id === filters.clientId)
    : (await listClients()).filter((c) => c.status === "ACTIVE");

  const rows: Record<string, string | number>[] = [];

  for (const client of clients) {
    const snapshot = await getCurrentHourBank(client.id);
    if (!snapshot) continue;

    const utilizationPct = snapshot.utilization.utilizationPct;

    let atRiskThreshold = DEFAULT_AT_RISK_PCT;
    if (utilizationPct < 100) {
      const rules = await listAlertRulesForClient(client.id);
      const pctThresholds = rules
        .filter((r) => r.enabled && r.type === "UTILIZATION_PCT")
        .map((r) => r.thresholdValue);
      if (pctThresholds.length > 0) atRiskThreshold = Math.min(...pctThresholds);
    }

    const classification = classifyUtilizationRisk(
      utilizationPct,
      snapshot.utilization.remainingMinutes,
      atRiskThreshold
    );
    if (classification === "OK") continue;

    rows.push({
      client: client.name,
      status: classification === "OVERAGE" ? "חריגה" : "בסיכון",
      utilizationPct,
      remainingMinutes: snapshot.utilization.remainingMinutes,
      thresholdUsed: atRiskThreshold,
    });
  }

  rows.sort((a, b) => (b.utilizationPct as number) - (a.utilizationPct as number));

  return {
    type: "overage_at_risk",
    title: "חריגה / בסיכון",
    columns: [
      { key: "client", label: "לקוח" },
      { key: "status", label: "סטטוס" },
      { key: "utilizationPct", label: "אחוז ניצול", type: "percent" },
      { key: "remainingMinutes", label: "נותר", type: "minutes" },
      { key: "thresholdUsed", label: "סף שבו נעשה שימוש", type: "percent" },
    ],
    rows,
  };
}

/// Spec 6.1: "אם הטיימר רץ זמן חריג (למשל 8/12 שעות configurable)" - the
/// same 8-hour default this report and the Overview screen's anomaly card
/// both use to flag a running timer as unusually long.
export const LONG_TIMER_HOURS = 8;

/// Spec 14.2 row 8: "Active Timers | טיימרים פעילים וזמן ריצה."
async function activeTimers(filters: ReportFilters): Promise<ReportResult> {
  const timers = await prisma.timeEntry.findMany({
    where: { deletedAt: null, endAt: null, clientId: filters.clientId, userId: filters.userId },
    orderBy: { startAt: "asc" },
    include: { client: true, category: true, user: true },
  });

  const now = Date.now();
  const rows = timers.map((t) => {
    const elapsedMinutes = round((now - t.startAt.getTime()) / 60000);
    return {
      employee: t.user.name,
      client: t.client.name,
      category: t.category.name,
      startedAt: t.startAt.toISOString(),
      elapsedMinutes,
      longRunning: elapsedMinutes >= LONG_TIMER_HOURS * 60 ? "כן" : "לא",
    };
  });

  return {
    type: "active_timers",
    title: "טיימרים פעילים",
    columns: [
      { key: "employee", label: "עובד" },
      { key: "client", label: "לקוח" },
      { key: "category", label: "קטגוריה" },
      { key: "startedAt", label: "התחלה" },
      { key: "elapsedMinutes", label: "זמן ריצה", type: "minutes" },
      { key: "longRunning", label: "ריצה ארוכה חריגה" },
    ],
    rows,
  };
}

/// Spec 14.2 row 9: "Capacity | שעות עובד בתקופה + חלוקה ללקוחות." One row
/// per employee (their period total), with the per-client split flattened
/// into a single semicolon-separated text cell rather than nested columns
/// - CSV/table cells are scalar, and a composite text summary is enough to
/// answer "how is this employee's time divided" without duplicating the
/// full cross-tab the "Employee x Client Matrix" report above already
/// provides for anyone who needs every individual pairing.
async function capacity(filters: ReportFilters): Promise<ReportResult> {
  const entries = await fetchEntries(filters);
  const byUser = new Map<
    string,
    { userName: string; actualSeconds: number; billableSeconds: number; perClient: Map<string, number> }
  >();

  for (const e of entries) {
    const row = byUser.get(e.userId) ?? {
      userName: e.user.name,
      actualSeconds: 0,
      billableSeconds: 0,
      perClient: new Map<string, number>(),
    };
    row.actualSeconds += e.actualSeconds ?? 0;
    row.billableSeconds += e.billableSeconds ?? 0;
    row.perClient.set(e.client.name, (row.perClient.get(e.client.name) ?? 0) + toMinutes(e.billableSeconds));
    byUser.set(e.userId, row);
  }

  const rows = [...byUser.values()]
    .map((r) => ({
      employee: r.userName,
      actualMinutes: toMinutes(r.actualSeconds),
      billableMinutes: toMinutes(r.billableSeconds),
      clientBreakdown: [...r.perClient.entries()].map(([name, minutes]) => `${name}: ${minutes}`).join("; "),
    }))
    .sort((a, b) => b.billableMinutes - a.billableMinutes);

  return {
    type: "capacity",
    title: "קיבולת עובדים",
    columns: [
      { key: "employee", label: "עובד" },
      { key: "actualMinutes", label: "בפועל", type: "minutes" },
      { key: "billableMinutes", label: "לחיוב", type: "minutes" },
      { key: "clientBreakdown", label: "חלוקה ללקוחות" },
    ],
    rows,
  };
}

/// Single entry point for both the Reports screen and the CSV export
/// route, so the two can never drift on what a given report type means.
/// Spec 4.1: every server endpoint checks Authorization itself.
export async function runReport(actor: User, type: ReportType, filters: ReportFilters): Promise<ReportResult> {
  assertCan(actor.role, "report.internal.view");

  switch (type) {
    case "total_client_hours":
      return totalClientHours(filters);
    case "hours_by_employee":
      return hoursByEmployee(filters);
    case "hours_by_client":
      return hoursByClient(filters);
    case "hours_by_category":
      return hoursByCategory(filters);
    case "employee_client_matrix":
      return employeeClientMatrix(filters);
    case "manual_edits":
      return manualEdits(filters);
    case "overage_at_risk":
      return overageAtRisk(filters);
    case "active_timers":
      return activeTimers(filters);
    case "capacity":
      return capacity(filters);
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown report type: ${exhaustive}`);
    }
  }
}
