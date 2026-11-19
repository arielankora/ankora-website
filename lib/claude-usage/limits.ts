// Claude usage measurement, way 3 (17.11.2026): reading what the Ankora
// browser extension sends (tools/claude-limits-extension). Pure, so tests
// load it without a database.
//
// The extension reads claude.ai's own usage endpoint, the one behind
// Settings > Usage: the share of the five-hour window and of the weekly
// limit already used, and when each resets. Usage limits belong to the
// account, not to a surface, so these two numbers cover the browser, the
// phone, the desktop app and Claude Code alike: the one view of "how close
// is this person to getting stuck" that telemetry cannot give on a Team plan.
//
// The endpoint is not documented and may change. The extension sends what
// it read; anything that is not a sane percentage or date is dropped here
// rather than stored.

export type LimitReading = {
  email: string;
  /// The other address, when the extension had two (the Claude account's
  /// and the Chrome profile's). Used only for matching to a user.
  altEmail: string | null;
  fiveHourPct: number | null;
  fiveHourResetsAt: Date | null;
  sevenDayPct: number | null;
  sevenDayResetsAt: Date | null;
  observedAt: Date;
  extensionVersion: string | null;
};

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

function email(v: unknown): string | null {
  return typeof v === "string" && EMAIL.test(v.trim()) ? v.trim().toLowerCase() : null;
}

/// A percentage of a limit used, 0 to 100. claude.ai can report a little
/// over 100 at the moment a limit is hit; that is clamped to 100.
function pct(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1000) return null;
  return Math.min(100, Math.round(n * 10) / 10);
}

function date(v: unknown, now: Date, maxAheadDays: number): Date | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const ahead = d.getTime() - now.getTime();
  // A reset time is in the near future; a reading's time is in the near
  // past. Anything far off either way is a broken clock or a broken field.
  if (ahead > maxAheadDays * 86_400_000 || ahead < -2 * 86_400_000) return null;
  return d;
}

export type ParseLimitResult = { ok: true; reading: LimitReading } | { ok: false; error: string };

/// The body the extension posts:
///   { email, altEmail?, fiveHour: { pct, resetsAt }, sevenDay: { pct, resetsAt },
///     observedAt, version }
export function parseLimitReading(body: unknown, now: Date = new Date()): ParseLimitResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const primary = email(b.email) ?? email(b.altEmail);
  if (!primary) return { ok: false, error: "No valid email" };
  const alt = email(b.altEmail);
  const five = (b.fiveHour && typeof b.fiveHour === "object" ? b.fiveHour : {}) as Record<string, unknown>;
  const seven = (b.sevenDay && typeof b.sevenDay === "object" ? b.sevenDay : {}) as Record<string, unknown>;
  const reading: LimitReading = {
    email: primary,
    altEmail: alt && alt !== primary ? alt : null,
    fiveHourPct: pct(five.pct),
    fiveHourResetsAt: date(five.resetsAt, now, 1),
    sevenDayPct: pct(seven.pct),
    sevenDayResetsAt: date(seven.resetsAt, now, 8),
    observedAt: date(b.observedAt, now, 0.01) ?? now,
    extensionVersion: typeof b.version === "string" ? b.version.slice(0, 20) : null,
  };
  if (reading.fiveHourPct === null && reading.sevenDayPct === null) return { ok: false, error: "No usage percentage" };
  return { ok: true, reading };
}

/// A reading older than this says nothing about now: the browser is closed,
/// or the extension stopped (claude.ai changed its endpoint, or signed out).
export const LIMIT_READING_FRESH_MS = 60 * 60_000;
/// 19.11.2026: an older reading is still shown, marked with its age, up to
/// this long. Hadas's laptop closed at 11:15 and the page went blank,
/// hiding that she was on pace to run out of the week the next day.
export const LIMIT_READING_KEEP_MS = 24 * 60 * 60_000;

/// A limit counts as hit at this share.
export const LIMIT_HIT_PCT = 100;

export type LimitSampleIn = {
  userId: string | null;
  fiveHourPct: number | null;
  fiveHourResetsAt: Date | null;
  sevenDayPct: number | null;
  sevenDayResetsAt: Date | null;
  observedAt: Date;
};

export type PersonLimits = {
  /// The latest reading, null when none is fresh.
  current: { fiveHourPct: number | null; fiveHourResetsAt: string | null; sevenDayPct: number | null; sevenDayResetsAt: string | null; observedAt: string } | null;
  /// When the last reading of any age arrived: shows an extension that stopped.
  lastReadingAt: string | null;
  /// The highest five-hour share seen in the period.
  peakFiveHourPct: number | null;
  /// Distinct five-hour windows that reached the limit in the period.
  fiveHourLimitHits: number;
  /// Distinct weeks that reached the weekly limit in the period.
  weeklyLimitHits: number;
};

/// One person's readings, any order, into what the screen shows.
export function personLimits(samples: LimitSampleIn[], now: Date): PersonLimits {
  const sorted = [...samples].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const last = sorted[sorted.length - 1];
  const fresh = last && now.getTime() - last.observedAt.getTime() <= LIMIT_READING_FRESH_MS ? last : null;
  // A window is known by when it resets; readings without a reset time are
  // grouped by the hour they were taken, which never double counts within
  // a five-hour window by more than its length.
  const hitWindows = (key: (s: LimitSampleIn) => string, pctOf: (s: LimitSampleIn) => number | null) =>
    new Set(sorted.filter((s) => (pctOf(s) ?? 0) >= LIMIT_HIT_PCT).map(key)).size;
  const peak = sorted.reduce<number | null>((m, s) => (s.fiveHourPct === null ? m : m === null ? s.fiveHourPct : Math.max(m, s.fiveHourPct)), null);
  return {
    current: fresh
      ? {
          fiveHourPct: fresh.fiveHourPct,
          fiveHourResetsAt: fresh.fiveHourResetsAt?.toISOString() ?? null,
          sevenDayPct: fresh.sevenDayPct,
          sevenDayResetsAt: fresh.sevenDayResetsAt?.toISOString() ?? null,
          observedAt: fresh.observedAt.toISOString(),
        }
      : null,
    lastReadingAt: last?.observedAt.toISOString() ?? null,
    peakFiveHourPct: peak,
    fiveHourLimitHits: hitWindows((s) => s.fiveHourResetsAt?.toISOString() ?? s.observedAt.toISOString().slice(0, 13), (s) => s.fiveHourPct),
    weeklyLimitHits: hitWindows((s) => s.sevenDayResetsAt?.toISOString().slice(0, 10) ?? s.observedAt.toISOString().slice(0, 10), (s) => s.sevenDayPct),
  };
}
