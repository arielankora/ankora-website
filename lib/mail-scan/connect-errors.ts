// What Unipile's Hosted Auth says when it sends the employee back without a
// mailbox (27.11.2026: Ariel's first try ended in "failed" with no detail).
// Its words are shown on the connect page and written to the log, so they
// are cut to plain characters and a short length first.

const KEYS = ["error_type", "error_title", "error"] as const;

/// Unipile's own error words, or null when it named none.
export function providerErrorOf(params: URLSearchParams): string | null {
  for (const key of KEYS) {
    const clean = cleanDetail(params.get(key));
    if (clean) return clean;
  }
  return null;
}

/// A detail fit to show and log: letters, digits, spaces and a few marks,
/// at most 120 characters.
export function cleanDetail(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value
    .replace(/[^\p{L}\p{N} _.:,'()/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || null;
}
