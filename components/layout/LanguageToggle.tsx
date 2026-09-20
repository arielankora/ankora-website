"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/content";
import { cn } from "@/lib/utils";
import { getTranslatedBlogSlug } from "@/lib/blog-translations";

const LABELS: Record<Locale, string> = { he: "עברית", en: "EN" };
const LOCALES: Locale[] = ["he", "en"];

/**
 * Both languages, shown side by side in one bordered group, with the current one
 * filled gold. Radius 0, 38px tall.
 *
 * It used to be a single rounded pill naming only the other language, which meant the
 * control said "EN" while you were reading Hebrew and gave no indication of which
 * language you were currently in.
 *
 * The current locale renders as a span rather than a link — there is nowhere for it to
 * go, and a link to the page you are already on is noise for anyone tabbing through.
 */
export function LanguageToggle({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const segments = pathname.split("/").slice(2); // drop the leading "" and the current locale
  const rest = segments.join("/");

  function hrefFor(target: Locale) {
    if (segments[0] === "blog" && segments[1]) {
      // Blog article: slugs are chosen independently per locale and do not generally
      // match across /he and /en (see lib/blog-translations.ts), so naively swapping
      // the locale segment can point at a slug that doesn't exist in the other
      // language. Use the curated translation map, and fall back to the blog index
      // (always a valid page) rather than a guessed, possibly-broken URL.
      const translatedSlug = getTranslatedBlogSlug(locale, segments[1]);
      return translatedSlug ? `/${target}/blog/${translatedSlug}` : `/${target}/blog`;
    }
    return `/${target}${rest ? `/${rest}` : ""}`;
  }

  return (
    <div
      role="group"
      aria-label="Language"
      className="flex h-[38px] flex-none border border-[rgba(243,234,219,0.22)]"
    >
      {LOCALES.map((target) => {
        const current = target === locale;
        const className = cn(
          "flex items-center px-3.5 font-assistant text-[13px] font-semibold tracking-[0.08em] transition-colors duration-[250ms]",
          current ? "bg-gold text-navy" : "text-muted hover:text-gold"
        );
        return current ? (
          <span key={target} aria-current="true" className={className}>
            {LABELS[target]}
          </span>
        ) : (
          <Link key={target} href={hrefFor(target)} hrefLang={target} className={className}>
            {LABELS[target]}
          </Link>
        );
      })}
    </div>
  );
}
