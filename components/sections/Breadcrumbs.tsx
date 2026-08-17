import Link from "next/link";
import type { Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { JsonLd } from "@/components/seo/JsonLd";

export function Breadcrumbs({
  locale,
  items,
}: {
  locale: Locale;
  items: { label: string; href?: string }[];
}) {
  const base = "https://ankora.co.il";
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: `${base}${withLocale(locale, item.href)}` } : {}),
    })),
  };

  return (
    <>
      <JsonLd id="breadcrumb-schema" data={schema} />
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-paper/40">
        {items.map((item, i) => (
          <span key={item.label} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden>/</span>}
            {item.href ? (
              <Link href={withLocale(locale, item.href)} className="transition-colors hover:text-gold-light">
                {item.label}
              </Link>
            ) : (
              <span className="text-paper/60">{item.label}</span>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}
