import Link from "next/link";
import type { Locale } from "@/content";
import { withLocale } from "@/lib/nav";

export function RelatedLinks({
  locale,
  label,
  items,
}: {
  locale: Locale;
  label: string;
  items: { label: string; href: string }[];
}) {
  return (
    <section className="bg-paper py-14 md:py-16">
      <div className="mx-auto w-full max-w-content px-6 md:px-10 lg:px-14">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-navy/35">{label}</span>
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={withLocale(locale, item.href)}
              className="text-sm font-medium text-navy/70 underline decoration-gold/40 underline-offset-4 transition-colors hover:text-navy hover:decoration-gold"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
