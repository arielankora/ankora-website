// The way back from a detail screen to the list it was opened from.
//
// Generalises tasks/list-query.ts (7.10.2026) to every list, 19.10.2026.
// The list's own query travels with the link as `?from=`, and the
// detail screen turns it back into the list's address. In the URL, not
// browser storage: it survives a reload, a second tab and a pasted link.
//
// `from` is read off the address bar, so it is input: only the list's
// own keys survive, values are bounded, and the result is always a path
// under the list's own base, never somewhere else.

const MAX_VALUE = 200;

/// Keeps only `keys` from a query, each value bounded. Empty when none survive.
export function cleanListQuery(input: URLSearchParams, keys: readonly string[]): string {
  const out = new URLSearchParams();
  for (const key of keys) {
    const value = input.get(key);
    if (value && value.length <= MAX_VALUE) out.set(key, value);
  }
  return out.toString();
}

/// A list page's current state as a query string, from its searchParams.
export function listQueryOf(
  searchParams: Record<string, string | string[] | undefined>,
  keys: readonly string[],
): string {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = searchParams[key];
    if (typeof value === "string") params.set(key, value);
  }
  return cleanListQuery(params, keys);
}

/// A detail screen's address, remembering the list it was opened from.
export function withFrom(path: string, listQuery?: string | null): string {
  return listQuery ? `${path}?from=${encodeURIComponent(listQuery)}` : path;
}

/// The list to go back to, from a detail screen's `from`. The list's
/// defaults when there is none or nothing in it survives.
export function listBackHref(base: string, keys: readonly string[], from?: string | string[] | null): string {
  if (typeof from !== "string" || !from) return base;
  const query = cleanListQuery(new URLSearchParams(from), keys);
  return query ? `${base}?${query}` : base;
}

/// Every key each list reads. A filter added to a list but not listed
/// here is simply not carried back, which is the safe way to fail.
export const CLIENTS_LIST_KEYS = ["q"] as const;
export const IMPORTANT_DATES_LIST_KEYS = ["tab"] as const;
