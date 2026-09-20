/**
 * Reading time, derived rather than authored.
 *
 * The blog already computes this from its MDX with the `reading-time` package. The SEO
 * pages have no MDX -- their content is in the dictionary -- so they compute it the
 * same way from the same source of truth. The handoff's key note asks for exactly this:
 * one derivation, nothing authored in two places, so a page that grows a section cannot
 * keep advertising its old length.
 *
 * 200 words per minute, which is what `reading-time` uses, so the two surfaces agree.
 */
const WORDS_PER_MINUTE = 200;

function countWords(value: unknown, acc: { n: number }): void {
  if (typeof value === "string") {
    acc.n += value.trim().split(/\s+/).filter(Boolean).length;
  } else if (Array.isArray(value)) {
    for (const v of value) countWords(v, acc);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) countWords(v, acc);
  }
}

/** Walks every string in a page's dictionary subtree. */
export function readingMinutes(pageContent: unknown): number {
  const acc = { n: 0 };
  countWords(pageContent, acc);
  return Math.max(1, Math.round(acc.n / WORDS_PER_MINUTE));
}
