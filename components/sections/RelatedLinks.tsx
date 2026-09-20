import Link from "next/link";
import type { Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { MonoLabel } from "@/components/ui/MonoLabel";

/**
 * The related-reading foot: a 1px grid of outlined cells, one per link.
 *
 * Replaces a pair of forked he/en implementations, one of which was a row of
 * underlined inline links on a cream ground. Each cell is its own target at 56px,
 * which is what a list of links at the foot of a 3,000-word page needs on a phone.
 */
export function RelatedLinks({
  locale,
  label,
  items,
}: {
  locale: Locale;
  label: string;
  items: { label: string; href: string }[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="mt-[clamp(52px,6vw,80px)] border-t border-[rgba(243,234,219,0.12)] pt-[22px]">
      <MonoLabel size={10} className="text-muted">
        {label}
      </MonoLabel>
      <div className="mt-4 flex flex-col gap-px">
        {items.map((item) => (
          <Link
            key={item.href}
            href={withLocale(locale, item.href)}
            className="group flex min-h-[56px] items-center justify-between gap-5 px-5 py-[18px] outline outline-1 outline-[rgba(243,234,219,0.11)] transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.04)]"
          >
            <span className="text-[1.05rem] font-normal text-cream transition-colors group-hover:text-gold">
              {item.label}
            </span>
            {/* Direction comes from the document, so one glyph would point the wrong
                way in one of the two locales. */}
            <MonoLabel
              size={12}
              aria-hidden
              className="flex-none text-muted transition-colors group-hover:text-gold"
            >
              {locale === "he" ? "←" : "→"}
            </MonoLabel>
          </Link>
        ))}
      </div>
    </section>
  );
}
