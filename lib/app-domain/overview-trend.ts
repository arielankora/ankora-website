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
// App redesign (design_handoff_ankora_app_redesign/README.md, screen 1
// "בית"): "מתג פילוח: לפי עובד / לפי לקוח / לפי קטגוריה... זו יכולת
// מחייבת - לא להחליף בגרף חד־צבעי." Added "category" alongside the
// existing employee/client dimensions from the direction-A follow-up this
// chart first shipped with.
export type TrendDimension = "employee" | "client" | "category";

/// Which seconds a bar counts. "actual" is the time that was worked;
/// "billable" is what the client is charged for, after the billing
/// policy's minimum per entry (a 3-minute call bills as 15). The two
/// answer different questions, "how busy were we" and "how much did we
/// sell", and the chart used to show only the first without saying so.
export type TrendBasis = "actual" | "billable";

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
  /// Calendar dates the bucket covers, "27.9 - 3.10" for a week and
  /// "9.10" for a day. A relative label alone ("לפני 4 שבועות") made
  /// people stop and count backwards to know which week they were
  /// looking at.
  range: string;
  /// The bucket is still running (today, or this week so far). Drawn
  /// lighter so a half-finished week does not read as a slow one.
  partial: boolean;
  segments: TrendSegment[];
}

export interface TrendSeries {
  /// Legend order (also the stacking order), computed once from the
  /// widest window (7 weeks) so it's identical across day/week toggles.
  legend: { key: string; name: string }[];
  buckets: TrendBucket[];
}

export type HoursTrendData = Record<TrendBasis, Record<TrendUnit, Record<TrendDimension, TrendSeries>>>;

export type EntryRow = {
  startAt: Date;
  actualSeconds: number | null;
  /// Null on entries written before the billing policy existed; those
  /// bill as their actual time, the same fallback the reports use.
  billableSeconds?: number | null;
  userId: string;
  clientId: string;
  categoryId: string;
  userName: string;
  clientName: string;
  categoryName: string;
};

function keyAndName(dimension: TrendDimension, e: EntryRow): { key: string; name: string } {
  if (dimension === "employee") return { key: e.userId, name: e.userName };
  if (dimension === "category") return { key: e.categoryId, name: e.categoryName };
  return { key: e.clientId, name: e.clientName };
}

/// UTC-calendar weekday of a `YYYY-MM-DD` key is timezone-free once you
/// already have the local calendar date (same trick as
/// report-schedules.ts's computeReportingPeriod) - no need to re-resolve
/// through `TIMEZONE` a second time.
function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function secondsFor(e: EntryRow, basis: TrendBasis): number {
  if (basis === "billable") return e.billableSeconds ?? e.actualSeconds ?? 0;
  return e.actualSeconds ?? 0;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function buildSeries(
  entries: EntryRow[],
  dimension: TrendDimension,
  windows: TrendWindow[],
  legendKeys: { key: string; name: string }[],
  basis: TrendBasis = "actual"
): TrendSeries {
  const legendKeySet = new Set(legendKeys.map((l) => l.key));

  const buckets = windows.map(({ from, to, label, range, partial }) => {
    const totals = new Map<string, { name: string; seconds: number }>();
    for (const e of entries) {
      if (e.startAt < from || e.startAt >= to) continue;
      const { key: rawKey, name } = keyAndName(dimension, e);
      const key = legendKeySet.has(rawKey) ? rawKey : OTHER_KEY;
      const row = totals.get(key) ?? { name: key === OTHER_KEY ? OTHER_LABEL : name, seconds: 0 };
      row.seconds += secondsFor(e, basis);
      totals.set(key, row);
    }
    const segments = legendKeys.map(({ key, name }) => ({
      key,
      name,
      // Unrounded on purpose. Rounding each segment to 0.1 here and then
      // summing the rounded segments made the total depend on how many
      // segments a bar was split into: 130.1 hours "by employee" (three
      // segments) but 130.3 "by client" (five) for the same entries
      // (9.10.2026). The chart rounds once, at display time.
      hours: (totals.get(key)?.seconds ?? 0) / 3600,
    }));
    return { label, range, partial, segments };
  });

  return { legend: legendKeys, buckets };
}

/// Ranks every distinct employee/client by total actual hours across the
/// full fetched window, keeps the top 5, and folds the rest into a single
/// "אחר" bucket - an unbounded per-person legend would both overflow a
/// compact home-page card and defeat the "readable at a glance" point of
/// putting this on the Overview screen at all.
///
/// The "אחר" slot is part of the legend itself. Until 9.10.2026 it was
/// not: buildSeries summed the remainder under OTHER_KEY but only emitted
/// segments for legend keys, so everything outside the top 5 silently
/// vanished. On the category view that was 53 of 130 hours, and in one
/// week the largest category of all was not on the chart. The three
/// views must always add up to the same total.
export function topLegend(entries: EntryRow[], dimension: TrendDimension): { key: string; name: string }[] {
  const totals = new Map<string, { name: string; seconds: number }>();
  for (const e of entries) {
    const { key, name } = keyAndName(dimension, e);
    const row = totals.get(key) ?? { name, seconds: 0 };
    row.seconds += e.actualSeconds ?? 0;
    totals.set(key, row);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1].seconds - a[1].seconds);
  const legend = ranked.slice(0, TOP_N).map(([key, v]) => ({ key, name: v.name }));
  if (ranked.length > TOP_N) legend.push({ key: OTHER_KEY, name: OTHER_LABEL });
  return legend;
}

export interface TrendWindow {
  from: Date;
  to: Date;
  label: string;
  range: string;
  partial: boolean;
}

/// "2026-10-03" -> "3.10". Day and month only, the Israeli way, with no
/// leading zeros: the year is never in doubt on a 7-week chart.
function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${d}.${m}`;
}

/// Pure date-math core of this module, split out from `getHoursTrend` so
/// it's directly unit-testable without touching Prisma (same rationale,
/// and same "will not run in this sandbox but runs for real in CI/Vercel"
/// caveat, as report-schedules.ts's `computeReportingPeriod` - see
/// tests/unit/overview-trend.test.ts). Takes `now` as a parameter (instead
/// of reading `new Date()` internally) specifically so tests can pin it.
export function computeTrendWindows(now: Date): { dayWindows: TrendWindow[]; weekWindows: TrendWindow[] } {
  const todayKey = localDateKey(now);

  // --- Day windows: last 14 calendar days, including today-so-far. ---
  // App redesign (handoff README, screen 1): "גרף מגמה 14 ימים" - widened
  // from the direction-A follow-up's original 7 days. Week windows below
  // are unrelated to this spec (not mentioned there) and are left as-is.
  const DAY_WINDOW_LENGTH = 14;
  const dayKeys = Array.from({ length: DAY_WINDOW_LENGTH }, (_, i) => addDaysToDateKey(todayKey, i - (DAY_WINDOW_LENGTH - 1)));
  const dayWindows = dayKeys.map((dateKey, i) => ({
    from: localDateTimeToUtc(dateKey, "00:00", TIMEZONE),
    to: localDateTimeToUtc(addDaysToDateKey(dateKey, 1), "00:00", TIMEZONE),
    label: i === DAY_WINDOW_LENGTH - 1 ? `${WEEKDAY_LABELS[weekdayOf(dateKey)]} (היום)` : WEEKDAY_LABELS[weekdayOf(dateKey)],
    range: shortDate(dateKey),
    partial: i === DAY_WINDOW_LENGTH - 1,
  }));

  // --- Week windows: the 6 complete Sun-Sat weeks before this one, and
  // this week so far. Until 9.10.2026 the current week was left out so a
  // partial total would not look like a slow week. The cost was worse: on
  // a Friday the chart hid five days of work (36 hours, most of a new
  // employee's first week), and "שבוע שעבר" read as the latest number.
  // The running week is now shown, marked `partial` and drawn lighter. ---
  const todayWeekday = weekdayOf(todayKey);
  const startOfThisWeekKey = addDaysToDateKey(todayKey, -todayWeekday);
  const weekLabels = ["לפני 6 שבועות", "לפני 5 שבועות", "לפני 4 שבועות", "לפני 3 שבועות", "לפני 2 שבועות", "שבוע שעבר", "השבוע"];
  const weekWindows = weekLabels.map((label, i) => {
    const weeksAgo = 6 - i; // 6,5,4,3,2,1,0
    const startKey = addDaysToDateKey(startOfThisWeekKey, -7 * weeksAgo);
    const endKey = addDaysToDateKey(startKey, 7);
    const isCurrent = weeksAgo === 0;
    // This week's range ends today, not on Saturday: it says what the
    // bar actually contains.
    const lastDayKey = isCurrent ? todayKey : addDaysToDateKey(endKey, -1);
    return {
      from: localDateTimeToUtc(startKey, "00:00", TIMEZONE),
      to: localDateTimeToUtc(endKey, "00:00", TIMEZONE),
      label,
      // Sunday to Saturday (or to today), both inclusive, as people read it.
      range: startKey === lastDayKey ? shortDate(startKey) : `${shortDate(startKey)} - ${shortDate(lastDayKey)}`,
      partial: isCurrent,
    };
  });

  return { dayWindows, weekWindows };
}

export async function getHoursTrend(): Promise<HoursTrendData> {
  const { dayWindows, weekWindows } = computeTrendWindows(new Date());
  const overallFrom = weekWindows[0].from;
  const overallTo = dayWindows[dayWindows.length - 1].to;

  type RawRow = {
    startAt: Date;
    actualSeconds: number | null;
    billableSeconds: number | null;
    userId: string;
    clientId: string;
    categoryId: string;
    user: { name: string };
    client: { name: string };
    category: { name: string };
  };

  const rawEntries: RawRow[] = await prisma.timeEntry.findMany({
    where: {
      deletedAt: null,
      endAt: { not: null },
      startAt: { gte: overallFrom, lt: overallTo },
      // Internal Ankora work is not client work. See Client.isInternal.
      client: { isInternal: false },
    },
    select: {
      startAt: true,
      actualSeconds: true,
      billableSeconds: true,
      userId: true,
      clientId: true,
      categoryId: true,
      user: { select: { name: true } },
      client: { select: { name: true } },
      category: { select: { name: true } },
    },
  });
  const entries: EntryRow[] = rawEntries.map((e: RawRow) => ({
    startAt: e.startAt,
    actualSeconds: e.actualSeconds,
    billableSeconds: e.billableSeconds,
    userId: e.userId,
    clientId: e.clientId,
    categoryId: e.categoryId,
    userName: e.user.name,
    clientName: e.client.name,
    categoryName: e.category.name,
  }));

  // Legend/ranking uses the full fetched window (superset of both unit
  // ranges) so "who's in the top 5" reflects overall recent activity, not
  // just whichever toggle happens to be selected.
  const employeeLegend = topLegend(entries, "employee");
  const clientLegend = topLegend(entries, "client");
  const categoryLegend = topLegend(entries, "category");

  // Legend order comes from actual hours for both bases, so switching
  // between "בפועל" and "לחיוב" never reshuffles colors.
  const legends: Record<TrendDimension, { key: string; name: string }[]> = {
    employee: employeeLegend,
    client: clientLegend,
    category: categoryLegend,
  };
  const dims: TrendDimension[] = ["employee", "client", "category"];
  const forUnit = (windows: TrendWindow[], basis: TrendBasis) =>
    Object.fromEntries(dims.map((d) => [d, buildSeries(entries, d, windows, legends[d], basis)])) as Record<
      TrendDimension,
      TrendSeries
    >;

  return {
    actual: { day: forUnit(dayWindows, "actual"), week: forUnit(weekWindows, "actual") },
    billable: { day: forUnit(dayWindows, "billable"), week: forUnit(weekWindows, "billable") },
  };
}
