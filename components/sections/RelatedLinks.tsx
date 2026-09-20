import Link from "next/link";
import type { Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { WideContainer } from "@/components/ui/WideContainer";

function HeRelatedLinks({
  locale,
  label,
  items,
}: {
  locale: Locale;
  label: string;
  items: { label: string; href: string }[];
}) {
  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-10 md:py-12">
      <WideContainer>
        <span className="font-jbmono text-[11px] tracking-[0.15em] text-[#7C8EA3]">{label}</span>
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={withLocale(locale, item.href)}
              className="border-b border-[rgba(176,141,87,0.45)] pb-0.5 text-sm font-medium text-cream transition-colors hover:text-gold"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </WideContainer>
    </section>
  );
}

export function RelatedLinks({
  locale,
  label,
  items,
}: {
  locale: Locale;
  label: string;
  items: { label: string; href: string }[];
}) {
  if (locale === "he") {
    return <HeRelatedLinks locale={locale} label={label} items={items} />;
  }

  return (
    <section className="bg-cream py-14 md:py-16">
      <div className="mx-auto w-full max-w-content px-6 md:px-10 lg:px-14">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-appNavy/35">{label}</span>
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={withLocale(locale, item.href)}
              className="text-sm font-medium text-appNavy/70 underline decoration-gold/40 underline-offset-4 transition-colors hover:text-appNavy hover:decoration-gold"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
