// Claude usage measurement, the five-hour window (17.11.2026, Ariel:
// "סף חודשי זה טוב אבל לרוב הם נתקעים דווקא בסף של החמש שעות"). The top
// of the "שימוש בקלוד" screen follows design option ג: where everyone
// stands in the current window, and the past week window by window.
// Pure, so every rule is tested without a database.
//
// Two sources, the better one first:
//   the browser extension (way 3)  the real share of the window and when
//                                  it resets, for every surface at once
//   Cowork and Claude Code         only when a limit was hit (a 429), and
//                                  the windows cut from request times
// A window seen by both is shown once, with the extension's share.

import { TIMEZONE } from "@/lib/timezone";
import { WINDOW_MS, fiveHourWindows, isLimitHit, type CoworkEventIn } from "@/lib/claude-usage/report-math";
import { LIMIT_HIT_PCT, LIMIT_READING_FRESH_MS, type LimitSampleIn } from "@/lib/claude-usage/limits";

/// From this share a window is worth watching, and from NEAR_PCT the
/// person is likely to get stuck before it resets.
export const WATCH_PCT = 70;
export const NEAR_PCT = 90;

/// The week the screen shows, window by window.
export const WEEK_MS = 7 * 86_400_000;

export type FiveHourState = "stuck" | "near" | "watch" | "free" | "idle" | "unknown";

export type WindowCell = {
  start: string;
  /// The highest share seen in the window; null when only Cowork saw it
  /// and no limit was hit (the share is not known).
  peakPct: number | null;
  hit: boolean;
  /// When the limit was hit, if it was.
  hitAt: string | null;
  /// true: the extension measured it. false: cut from Cowork's requests.
  measured: boolean;
};

export type PersonFiveHour = {
  current: {
    state: FiveHourState;
    pct: number | null;
    resetsAt: string | null;
    /// When the limit was hit in the current window, if it was.
    hitAt: string | null;
    /// Where the figure came from: the extension, or Cowork's 429 alone.
    source: "extension" | "cowork" | null;
  };
  weeklyPct: number | null;
  /// The past week's windows, oldest first.
  week: WindowCell[];
  hitsThisWeek: number;
};

export function stateOf(pct: number | null): FiveHourState {
  if (pct === null) return "unknown";
  if (pct >= LIMIT_HIT_PCT) return "stuck";
  if (pct >= NEAR_PCT) return "near";
  if (pct >= WATCH_PCT) return "watch";
  if (pct > 0) return "free";
  return "idle";
}

type Win = { start: number; end: number; peak: number | null; hitAt: number | null; measured: boolean };

/// The extension's readings cut into windows. A window is known by when it
/// resets; windows are at least five hours apart, so the hour of the reset
/// is a safe key. A reading with a share but no reset time is put in the
/// window it falls in, or one that starts with it.
function extensionWindows(samples: LimitSampleIn[]): Win[] {
  const sorted = [...samples].filter((s) => s.fiveHourPct !== null).sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const byKey = new Map<number, Win>();
  const add = (end: number, s: LimitSampleIn) => {
    const key = Math.round(end / 3_600_000);
    const w = byKey.get(key) ?? { start: end - WINDOW_MS, end, peak: null, hitAt: null, measured: true };
    w.peak = Math.max(w.peak ?? 0, s.fiveHourPct!);
    if (w.hitAt === null && s.fiveHourPct! >= LIMIT_HIT_PCT) w.hitAt = s.observedAt.getTime();
    byKey.set(key, w);
  };
  for (const s of sorted) {
    if (s.fiveHourResetsAt) add(s.fiveHourResetsAt.getTime(), s);
  }
  for (const s of sorted) {
    if (s.fiveHourResetsAt || !s.fiveHourPct) continue;
    const t = s.observedAt.getTime();
    const home = [...byKey.values()].find((w) => t >= w.start && t < w.end);
    if (home) {
      home.peak = Math.max(home.peak ?? 0, s.fiveHourPct);
      if (home.hitAt === null && s.fiveHourPct >= LIMIT_HIT_PCT) home.hitAt = t;
    } else add(t + WINDOW_MS, s);
  }
  return [...byKey.values()].filter((w) => (w.peak ?? 0) > 0);
}

/// One person: their extension readings and their Cowork/Claude Code
/// events, any order, any span. `now` decides what is current.
export function personFiveHour(samples: LimitSampleIn[], events: CoworkEventIn[], now: Date): PersonFiveHour {
  const t = now.getTime();
  const ext = extensionWindows(samples);
  const hitTimes = events.filter(isLimitHit).map((e) => e.occurredAt.getTime()).sort((a, b) => a - b);
  const wins: Win[] = [...ext];
  for (const w of fiveHourWindows(events)) {
    const start = w.start.getTime();
    const end = start + WINDOW_MS;
    const hitAt = hitTimes.find((h) => h >= start && h < end) ?? null;
    // The same window the extension saw: its window starts at Claude's own
    // first message, which may be in another product, so overlap is enough.
    const same = ext.find((x) => start < x.end && end > x.start);
    if (same) {
      if (hitAt !== null && same.hitAt === null) {
        same.hitAt = hitAt;
        same.peak = LIMIT_HIT_PCT;
      }
      continue;
    }
    wins.push({ start, end, peak: hitAt !== null ? LIMIT_HIT_PCT : null, hitAt, measured: false });
  }
  wins.sort((a, b) => a.start - b.start);

  // Now: the freshest extension reading, unless its window already reset.
  const latest = [...samples].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0];
  const fresh = latest && t - latest.observedAt.getTime() <= LIMIT_READING_FRESH_MS ? latest : null;
  let current: PersonFiveHour["current"];
  const open = wins.find((w) => w.start <= t && t < w.end);
  if (fresh && fresh.fiveHourPct !== null) {
    const reset = fresh.fiveHourResetsAt?.getTime() ?? null;
    const over = reset !== null && reset <= t;
    const pct = over ? 0 : fresh.fiveHourPct;
    current = {
      state: stateOf(pct),
      pct,
      resetsAt: over || reset === null ? null : new Date(reset).toISOString(),
      hitAt: !over && open?.hitAt ? new Date(open.hitAt).toISOString() : null,
      source: "extension",
    };
  } else if (open?.hitAt) {
    // No reading, but Cowork says the limit was hit in a window still open.
    current = { state: "stuck", pct: LIMIT_HIT_PCT, resetsAt: new Date(open.end).toISOString(), hitAt: new Date(open.hitAt).toISOString(), source: "cowork" };
  } else {
    current = { state: "unknown", pct: null, resetsAt: null, hitAt: null, source: null };
  }

  const week = wins
    .filter((w) => w.end > t - WEEK_MS && w.start <= t)
    .map((w) => ({
      start: new Date(w.start).toISOString(),
      peakPct: w.peak === null ? null : Math.round(w.peak),
      hit: w.hitAt !== null,
      hitAt: w.hitAt === null ? null : new Date(w.hitAt).toISOString(),
      measured: w.measured,
    }));
  return {
    current,
    weeklyPct: fresh?.sevenDayPct ?? null,
    week,
    hitsThisWeek: week.filter((w) => w.hit).length,
  };
}

/// Local hour in Ankora's timezone.
function localHour(iso: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TIMEZONE }).format(new Date(iso));
  return Number(h) % 24;
}

/// Hits are grouped in bands of this many hours to name the peak hours.
export const PEAK_BAND_HOURS = 3;

export type TeamFiveHour = {
  stuckNow: { name: string; resetsAt: string | null; hitAt: string | null }[];
  /// At WATCH_PCT or more now, not yet stuck; highest first.
  over70Now: { name: string; pct: number }[];
  hitsThisWeek: number;
  /// The hours most hits fell in, when at least two did and they cluster.
  peakHours: { from: number; to: number; hits: number } | null;
  closestWeekly: { name: string; pct: number } | null;
  /// Anyone measured by the extension in the past hour.
  measuredNow: number;
};

export function teamFiveHour(people: { name: string; fiveHour: PersonFiveHour }[]): TeamFiveHour {
  const stuckNow = people
    .filter((p) => p.fiveHour.current.state === "stuck")
    .map((p) => ({ name: p.name, resetsAt: p.fiveHour.current.resetsAt, hitAt: p.fiveHour.current.hitAt }))
    .sort((a, b) => (a.resetsAt ?? "~").localeCompare(b.resetsAt ?? "~"));
  const over70Now = people
    .filter((p) => p.fiveHour.current.pct !== null && p.fiveHour.current.pct >= WATCH_PCT && p.fiveHour.current.state !== "stuck")
    .map((p) => ({ name: p.name, pct: Math.round(p.fiveHour.current.pct!) }))
    .sort((a, b) => b.pct - a.pct);
  const hits = people.flatMap((p) => p.fiveHour.week.filter((w) => w.hitAt).map((w) => w.hitAt!));
  const bands = new Map<number, number>();
  for (const h of hits) {
    const b = Math.floor(localHour(h) / PEAK_BAND_HOURS);
    bands.set(b, (bands.get(b) ?? 0) + 1);
  }
  const top = [...bands.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const peakHours = top && hits.length >= 2 && top[1] >= 2 && top[1] * 2 >= hits.length ? { from: top[0] * PEAK_BAND_HOURS, to: (top[0] + 1) * PEAK_BAND_HOURS, hits: top[1] } : null;
  const weekly = people
    .filter((p) => p.fiveHour.weeklyPct !== null)
    .map((p) => ({ name: p.name, pct: Math.round(p.fiveHour.weeklyPct!) }))
    .sort((a, b) => b.pct - a.pct)[0];
  return {
    stuckNow,
    over70Now,
    hitsThisWeek: people.reduce((n, p) => n + p.fiveHour.hitsThisWeek, 0),
    peakHours,
    closestWeekly: weekly ?? null,
    measuredNow: people.filter((p) => p.fiveHour.current.source === "extension").length,
  };
}
