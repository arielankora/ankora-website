// Manually-curated cross-locale mapping for blog posts that have a genuine
// translated/equivalent counterpart in the other language.
//
// Blog slugs are chosen independently per locale (see lib/blog-shared.ts'
// slugify() comment) - they are NOT guaranteed to match across /he/blog/X
// and /en/blog/X. The site-wide language toggle used to assume they did,
// which produced a live 404 for any post whose slugs differ (discovered via
// Google Search Console: /en/blog/esta, linked from the Hebrew ESTA
// article's language toggle - docs/adr/0001 SEO fix).
//
// Only posts with a real, published counterpart belong here. A post absent
// from this map has no known translation, so the toggle falls back to the
// other locale's blog index (/he/blog or /en/blog) - always a valid page -
// instead of guessing a slug that may not exist.
type Locale = "he" | "en";

const TRANSLATIONS: Record<string, string> = {
  "he/esta": "forgot-to-renew-your-esta-and-only-found-out-at-the-airport-here-s-what-to-do",
  "en/forgot-to-renew-your-esta-and-only-found-out-at-the-airport-here-s-what-to-do": "esta",
};

/**
 * Returns the slug of `slug`'s counterpart in the other locale, or null if
 * no translation is known.
 */
export function getTranslatedBlogSlug(locale: Locale, slug: string): string | null {
  return TRANSLATIONS[`${locale}/${slug}`] ?? null;
}
