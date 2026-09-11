import "server-only";
import { prisma } from "@/lib/prisma";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";

// Overview home-page chart (Ariel's request, redesign direction A
// follow-up): "כמות השעות המדווחות לפי עובד/לקוח ל-7 ימים/שבועות
// האחרונים". Deliberately its own file rather than another report type in
// reports.ts - the nine ReportType rows in reports.ts are spec 14.2's
// fixed table-shaped exports (CSV/XLSX/PDF); this is a small always-on
// home-page widget with a fundamentally different shape (a short,
// fixed-length time series, both units precomputed together so the client
// toggle never needs a network round trip) and no export/filter surface.

export type TrendUnit = "day" | "week";
export type TrendDimension = "employee" | "client";

const TOP_N = 5;
const OTHER_KEY = "__other__";
const OTHER_LABEL = "אחר";

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export interface TrendSegment {
  /// Stable key so the client can assign the same color/legend slot to the
  /// same person across every bucket and across both units - lets someone
  /// toggle "ימים"/"שבועות" without the bars visually reshuffling colors.
  key: string;
  name: string;
  hours: number;
}

export interface TrendBucket {
  label: string;
  segments: TrendSegment[];
}

export interface TrendSeries {
  /// Legend order (also the stacking order), computed once from the
  /// widest window (7 weeks) so it's identical across day/week toggles.
  legend: { key: string; name: string }[];
  buckets: TrendBucket[];
}

export interface HoursTrendData {
  day: Record<TrendDimension, TrendSeries>;
  week: Record<TrendDimension, TrendSeries>;
}

type EntryRow = {
  startAt: Date;
  actualSeconds: number | null;
  userId: string;
  clientId: string;
  userName: string;
  clientName: string;
};

function keyAndName(dimension: TrendDimension, e: EntryRow): { key: string; name: string } {
  return dimension === "employee" ? { key: e.userId, name: e.userName } : { key: e.clientId, name: e.clientName };
}

/// UTC-calendar weekday of a `YYYY-MM-DD` key is timezone-free once you
/// already have the local calendar date (same trick as
/// report-schedules.ts's computeReportingPeriod) - no need to re-resolve
/// through `TIMEZONE` a second time.
function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function buildSeries(
  entries: EntryRow[],
  dimension: TrendDimension,
  windows: { from: Date; to: Date; label: string }[],
  legendKeys: { key: string; name: string }[]
): TrendSeries {
  const legendKeySet = new Set(legendKeys.map((l) => l.key));

  const buckets = windows.map(({ from, to, label }) => {
    const totals = new Map<string, { name: string; seconds: number }>();
    for (const e of entries) {
      if (e.startAt < from || e.startAt >= to) continue;
      const { key: rawKey, name } = keyAndName(dimension, e);
      const key = legendKeySet.has(rawKey) ? rawKey : OTHER_KEY;
      const row = totals.get(key) ?? { name: key === OTHER_KEY ? OTHER_LABEL : name, seconds: 0 };
      row.seconds += e.actualSeconds ?? 0;
      totals.set(key, row);
    }
    const segments = legendKeys.map(({ key, name }) => ({
      key,
      name,
      hours: Math.round(((totals.get(key)?.seconds ?? 0) / 3600) * 10) / 10,
    }));
    return { label, segments };
  });

  return { legend: legendKeys, buckets };
}

/// Ranks every distinct employee/client by total actual hours across the
/// full fetched window, keeps the top 5, and folds the rest into a single
/// "אחר" bucket - an unbounded per-person legend would both overflow a
/// compact home-page card and defeat the "readable at a glance" point of
/// putting this on the Overview screen at all.
function topLegend(entries: EntryRow[], dimension: TrendDimension): { key: string; name: string }[] {
  const totals = new Map<string, { name: string; seconds: number }>();
  for (const e of entries) {
    const { key, name } = keyAndName(dimension, e);
    const row = totals.get(key) ?? { name, seconds: 0 };
    row.seconds += e.actualSeconds ?? 0;
    totals.set(key, row);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1].seconds - a[1].seconds)
    .slice(0, TOP_N)
    .map(([key, v]) => ({ key, name: v.name }));
}

export interface TrendWindow {
  from: Date;
  to: Date;
  label: string;
}

/// Pure date-math core of this module, split out from `getHoursTrend` so
/// it's directly unit-testable without touching Prisma (same rationale,
/// and same "will not run in this sandbox but runs for real in CI/Vercel"
/// caveat, as report-schedules.ts's `computeReportingPeriod` - see
/// tests/unit/overview-trend.test.ts). Takes `now` as a parameter (instead
/// of reading `new Date()` internally) specifically so tests can pin it.
export function computeTrendWindows(now: Date): { dayWindows: TrendWindow[]; weekWindows: TrendWindow[] } {
  const todayKey = localDateKey(now);

  // --- Day windows: last 7 calendar days, including today-so-far. ---
  const dayKeys = Array.from({ length: 7 }, (_, i) => addDaysToDateKey(todayKey, i - 6));
  const dayWindows = dayKeys.map((dateKey, i) => ({
    from: localDateTimeToUtc(dateKey, "00:00", TIMEZONE),
    to: localDateTimeToUtc(addDaysToDateKey(dateKey, 1), "00:00", TIMEZONE),
    label: i === 6 ? `${WEEKDAY_LABELS[weekdayOf(dateKey)]} (היום)` : WEEKDAY_LABELS[weekdayOf(dateKey)],
  }));

  // --- Week windows: last 7 COMPLETE Sun-Sat weeks, ending last week -
  // deliberately excludes the current in-progress week so the most recent
  // bar is never a misleadingly-low partial total (same rationale as
  // report-schedules.ts's weekly-boundary math, reused here). ---
  const todayWeekday = weekdayOf(todayKey);
  const startOfThisWeekKey = addDaysToDateKey(todayKey, -todayWeekday);
  const weekLabels = ["לפני 7 שבועות", "לפני 6 שבועות", "לפני 5 שבועות", "לפני 4 שבועות", "לפני 3 שבועות", "לפני 2 שבועות", "שבוע שעבר"];
  const weekWindows = weekLabels.map((label, i) => {
    const weeksAgo = 7 - i; // 7,6,5,4,3,2,1
    const startKey = addDaysToDateKey(startOfThisWeekKey, -7 * weeksAgo);
    const endKey = addDaysToDateKey(startKey, 7);
    return {
      from: localDateTimeToUtc(startKey, "00:00", TIMEZONE),
      to: localDateTimeToUtc(endKey, "00:00", TIMEZONE),
      label,
    };
  });

  return { dayWindows, weekWindows };
}

export async function getHoursTrend(): Promise<HoursTrendData> {
  const { dayWindows, weekWindows } = computeTrendWindows(new Date());
  const overallFrom = weekWindows[0].from;
  const overallTo = dayWindows[6].to;

  type RawRow = {
    startAt: Date;
    actualSeconds: number | null;
    userId: string;
    clientId: string;
    user: { name: string };
    client: { name: string };
  };

  const rawEntries: RawRow[] = await prisma.timeEntry.findMany({
    where: { deletedAt: null, endAt: { not: null }, startAt: { gte: overallFrom, lt: overallTo } },
    select: {
      startAt: true,
      actualSeconds: true,
      userId: true,
      clientId: true,
      user: { select: { name: true } },
      client: { select: { name: true } },
    },
  });
  const entries: EntryRow[] = rawEntries.map((e: RawRow) => ({
    startAt: e.startAt,
    actualSeconds: e.actualSeconds,
    userId: e.userId,
    clientId: e.clientId,
    userName: e.user.name,
    clientName: e.client.name,
  }));

  // Legend/ranking uses the full fetched window (superset of both unit
  // ranges) so "who's in the top 5" reflects overall recent activity, not
  // just whichever toggle happens to be selected.
  const employeeLegend = topLegend(entries, "employee");
  const clientLegend = topLegend(entries, "client");

  return {
    day: {
      employee: buildSeries(entries, "employee", dayWindows, employeeLegend),
      client: buildSeries(entries, "client", dayWindows, clientLegend),
    },
    week: {
      employee: buildSeries(entries, "employee", weekWindows, employeeLegend),
      client: buildSeries(entries, "client", weekWindows, clientLegend),
    },
  };
}
