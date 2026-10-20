/// Numbers taken from a URL, parsed once so the rest of the code can trust
/// them.
///
/// The sibling of lib/period-offset.ts, and for the same reason. A query
/// string is typed by people and pasted into chats; every value in it is a
/// string of unknown shape, and `Number()` turns the bad ones into NaN or
/// Infinity rather than refusing. Neither throws where it is written. They
/// throw somewhere else, in Prisma or in Intl, as a 500 on a screen the
/// person was only looking at.
///
/// This repo has had that bug twice now. On 27.9.2026 three portal routes
/// took `?monthOffset=` straight from the URL, and `?monthOffset=abc` gave a
/// client-facing `RangeError: Invalid time value`. On 18.10.2026 the audit
/// log took `?page=` the same way.

/// A 1-based page number from a query string.
///
/// `Math.max(1, Number(raw) || 1)` looks like it handles everything, and
/// handles exactly the cases people think of. It does not handle the two
/// that matter:
///
///   ?page=1.001   Number is 1.001, truthy, and survives Math.max. It
///                 reaches Prisma as `skip: 0.025`, which Prisma rejects
///                 because skip must be a whole number. The screen 500s.
///   ?page=1e999   Number is Infinity, truthy, survives Math.max, and
///                 reaches Prisma as `skip: Infinity`. Same end.
///
/// `?page=abc` is NaN, which IS caught by `|| 1`, and a negative page is
/// caught by Math.max. Those are the ones that get thought of, and they are
/// not the ones that break.
///
/// A page number out of range is not an error worth a 500 either: somebody
/// following a stale link or editing the URL gets the first page, which is
/// what every paginated screen does when asked for a page that is not there.
export function parsePageNumber(raw: string | null | undefined, max = MAX_PAGE): number {
  const n = Number(raw ?? 1);
  if (!Number.isFinite(n)) return 1;
  const whole = Math.trunc(n);
  if (whole < 1) return 1;
  if (whole > max) return 1;
  return whole;
}

/// Generous on purpose. It only has to be small enough that `(page - 1) *
/// pageSize` stays a safe integer, not small enough to second-guess a
/// screen's own page count.
export const MAX_PAGE = 1_000_000;
