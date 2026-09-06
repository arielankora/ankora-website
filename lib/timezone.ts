import "server-only";

// Phase 8 addendum (spec 23: "Integration foundation validation +
// production rollout"; spec section 24 checklist item "Timezone tests
// around midnight/month boundary"). Extracted from a private helper that
// already existed correctly as `localDateKey` inside
// lib/app-domain/time-entries.ts, and was duplicated inline in
// lib/app-domain/billing.ts - this file is now the single shared source
// so every "which calendar day does this UTC instant fall on" decision in
// the app uses the same logic, instead of three slightly different
// implementations drifting apart.
//
// Spec section 0/25: all timestamps are stored in UTC; the default
// display/grouping timezone is Asia/Jerusalem. `Date.toISOString()` is
// UTC by definition, so `.slice(0, 10)` on it is only safe for grouping
// when the value already IS a UTC calendar boundary - it is NOT safe for
// "which day did this happen on, from Ankora's point of view", because
// Israel local time is ahead of UTC (+2 in winter, +3 in summer/DST): any
// entry between UTC midnight and Israel midnight (21:00-00:00 UTC in
// winter, 22:00-00:00 UTC in summer) has a UTC calendar date one day
// EARLIER than its correct Israel calendar date. A `startAt` of
// 2025-12-31T22:30:00Z is 2026-01-01 00:30 in Israel - `toISOString()`
// reports "2025-12-31", `localDateKey()` correctly reports "2026-01-01".
// This was a real bug found during this phase's own audit: reports.ts,
// client-portal.ts and report-schedules.ts all grouped/labeled entries by
// `startAt.toISOString().slice(0, 10)` (UTC date), so any entry logged in
// the ~2-3 hour window after UTC midnight but before Israel midnight would
// display under the wrong (previous) day in internal reports, the client
// portal's weekly activity view, and scheduled report emails. billing.ts's
// PER_DAY billing-policy grouping already used the correct
// Intl.DateTimeFormat approach inline, so billed amounts were never
// affected - only display/report date labels were wrong. See
// docs/adr/0001, Phase 8 addendum, for the full audit note.
export const TIMEZONE = "Asia/Jerusalem";

/// Formats a UTC `Date` as its `YYYY-MM-DD` calendar date in `TIMEZONE`
/// (Asia/Jerusalem), NOT in UTC. Use this instead of
/// `date.toISOString().slice(0, 10)` for anything that groups, labels, or
/// compares time entries "by day" from the user's point of view (reports,
/// exports, portal display, backdate detection) - `toISOString()` is only
/// correct for UTC-native concerns (cache keys, filenames, etc.) that have
/// nothing to do with a human's calendar day.
export function localDateKey(date: Date, timeZone: string = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date); // YYYY-MM-DD
}

/// Combines a `YYYY-MM-DD` date and `HH:mm` time - both wall-clock values
/// in `timeZone` (defaults to Asia/Jerusalem) - into the correct UTC
/// instant. Constructing `new Date(\`${date}T${time}\`)` directly is wrong:
/// it's parsed in whatever timezone the Node process itself runs in (UTC
/// on Vercel), silently shifting the intended local time by the target
/// zone's UTC offset. This computes that offset at the given instant
/// (correctly following DST, and independent of the server process's own
/// timezone - the process-timezone term cancels out algebraically in the
/// subtraction below) and corrects for it. Generalized in Phase 8 from a
/// Phase 2 helper (`combineWallClockTime` in time-entries.ts, hardcoded to
/// Asia/Jerusalem for manual time-entry input) so `computeReportingPeriod`
/// (report-schedules.ts) can convert a schedule's own LOCAL week/month
/// boundary back into the correct UTC instant for its Prisma query range,
/// instead of computing those boundaries in UTC calendar terms - see the
/// Phase 8 ADR addendum for the bug this fixes.
export function localDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string = TIMEZONE): Date {
  const naiveUtc = new Date(`${dateStr}T${timeStr}:00Z`);
  const asIfTargetZone = new Date(naiveUtc.toLocaleString("en-US", { timeZone }));
  const asIfUtc = new Date(naiveUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = asIfUtc.getTime() - asIfTargetZone.getTime();
  return new Date(naiveUtc.getTime() + offsetMs);
}
