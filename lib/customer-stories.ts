import type { Locale } from "@/content";
import he from "@/content/customer-stories/he";
import en from "@/content/customer-stories/en";
import type { CustomerStory, RelatedSolution } from "@/content/customer-stories/types";

/**
 * Read access to the story corpus. Pure data - no filesystem, no server-only import -
 * so the hub, the story page, the sitemap and the cross-page proof blocks all read the
 * same list, and a story added to one locale file appears everywhere at once.
 */
const BY_LOCALE: Record<Locale, CustomerStory[]> = { he, en };

export function getAllStories(locale: Locale): CustomerStory[] {
  return (BY_LOCALE[locale] ?? [])
    .filter((s) => !s.draft)
    .slice()
    .sort((a, b) => (a.publishedDate < b.publishedDate ? 1 : -1));
}

export function getStoryBySlug(locale: Locale, slug: string): CustomerStory | undefined {
  return getAllStories(locale).find((s) => s.slug === slug);
}

export function getAllStorySlugs(locale: Locale): string[] {
  return getAllStories(locale).map((s) => s.slug);
}

/**
 * The stories that are evidence for a given solution page, newest first. This is what
 * makes the cross-linking a network rather than a set of one-way links: a solution page
 * asks for its own evidence instead of hardcoding a slug, so publishing story #2 against
 * /solutions/founders puts it on that page with no edit there.
 */
export function getStoriesForSolution(
  locale: Locale,
  solution: RelatedSolution,
  limit = 2
): CustomerStory[] {
  return getAllStories(locale)
    .filter((s) => s.relatedSolutions?.includes(solution))
    .slice(0, limit);
}

/** Featured stories for the home page. Newest first; the home page takes one. */
export function getFeaturedStories(locale: Locale, limit = 1): CustomerStory[] {
  return getAllStories(locale).slice(0, limit);
}

export type { CustomerStory };
