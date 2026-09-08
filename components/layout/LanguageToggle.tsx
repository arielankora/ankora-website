"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/content";
import { cn } from "@/lib/utils";
import { getTranslatedBlogSlug } from "@/lib/blog-translations";

export function LanguageToggle({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const segments = pathname.split("/").slice(2); // drop the leading "" and the current locale
  const rest = segments.join("/");

  const other: Locale = locale === "he" ? "en" : "he";

  let otherHref: string;
  if (segments[0] === "blog" && segments[1]) {
    // Blog article: slugs are chosen independently per locale and do not
    // generally match across /he and /en (see lib/blog-translations.ts), so
    // naively swapping the locale segment can point at a slug that doesn't
    // exist in the other language. Use the curated translation map, and
    // fall back to the blog index (always a valid page) rather than a
    // guessed, possibly-broken URL.
    const translatedSlug = getTranslatedBlogSlug(locale, segments[1]);
    otherHref = translatedSlug ? `/${other}/blog/${translatedSlug}` : `/${other}/blog`;
  } else {
    otherHref = `/${other}${rest ? `/${rest}` : ""}`;
  }

  return (
    <Link
      href={otherHref}
      className={cn(
        "flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-paper/70",
        "transition-colors hover:border-lineGold hover:text-gold-light"
      )}
    >
      {other === "he" ? "עברית" : "EN"}
    </Link>
  );
}
