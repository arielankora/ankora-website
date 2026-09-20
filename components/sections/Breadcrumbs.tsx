import Link from "next/link";
import type { Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_URL } from "@/lib/site";
import { MonoLabel } from "@/components/ui/MonoLabel";

export function Breadcrumbs({
  locale,
  items,
}: {
  locale: Locale;
  items: { label: string; href?: string }[];
}) {
  const base = SITE_URL;
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

  // One treatment for both locales: the mono trail the redesign specifies. The
  // separator is a plain slash in both directions -- it is punctuation between
  // items, not an arrow, so it does not flip.
  return (
    <>
      <JsonLd id="breadcrumb-schema" data={schema} />
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2">
        {items.map((item, i) => (
          <span key={item.label} className="flex items-center gap-2">
            {i > 0 && (
              <MonoLabel size={10} tracking="0.1em" className="text-tone-faint" aria-hidden>
                /
              </MonoLabel>
            )}
            {item.href ? (
              <Link href={withLocale(locale, item.href)}>
                <MonoLabel size={10} tracking="0.1em" className="text-tone-dim transition-colors hover:text-gold">
                  {item.label}
                </MonoLabel>
              </Link>
            ) : (
              <MonoLabel size={10} tracking="0.1em" className="text-tone-muted">
                {item.label}
              </MonoLabel>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}
