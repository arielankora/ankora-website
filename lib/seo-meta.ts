/**
 * Fields every page's openGraph needs and none set before (SEO/GEO audit,
 * 1.10.2026): og:url, og:site_name and og:locale. Next merges metadata
 * shallowly, so a page that defines `openGraph` replaces the layout's whole
 * object; each page spreads this in instead.
 *
 * The share image is included for the same reason: app/[locale]/opengraph-image.tsx
 * only reaches pages that leave openGraph alone. A page with its own image (a
 * blog post, a customer story) sets `images` after this spread and wins.
 */
export function ogBase(locale: string, path: string) {
  return {
    url: `/${locale}${path}`,
    siteName: "Ankora",
    locale: locale === "he" ? "he_IL" : "en_US",
    alternateLocale: locale === "he" ? ["en_US"] : ["he_IL"],
    images: [{ url: `/${locale}/opengraph-image`, width: 1200, height: 630, alt: "Ankora" }],
  };
}
