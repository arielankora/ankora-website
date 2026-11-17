// Claude usage, stage 4 (17.11.2026): the rows get_proposal_stats returns,
// written short. The heaviest single call the connector made in its first
// week was get_proposal_stats with 500 rows, 378 KB, a third of all it
// sent. Most of a row is fields at their default: a dozen booleans that
// are false, nulls, empty lists. Leaving those out, and the two fields
// that repeat another, cuts a row by about 60% and loses nothing: the tool
// description says that a missing field is false, null or empty.
//
// Pure, so the rule is tested on its own.

/// Fields that repeat another one and are left out:
///   rejected   state is REJECTED
///   decidedAt  createdAt plus hoursToDecision
const DERIVED = new Set(["rejected", "decidedAt"]);

/// A row without its false, null and empty fields, and with createdAt to
/// the minute. Numbers stay, zero included: 0 hours to a decision is data.
export function compactRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (DERIVED.has(k)) continue;
    if (v === false || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = k === "createdAt" && typeof v === "string" ? toMinute(v) : v;
  }
  return out;
}

/// 2026-11-10T08:12:33.123Z → 2026-11-10T08:12Z
function toMinute(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? `${iso.slice(0, 16)}Z` : iso;
}
