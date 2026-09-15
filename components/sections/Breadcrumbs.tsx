import Link from "next/link";
import type { Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

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

  const isHe = locale === "he";

  return (
    <>
      <JsonLd id="breadcrumb-schema" data={schema} />
      <nav
        aria-label="Breadcrumb"
        className={cn(
          "flex flex-wrap items-center gap-2 text-xs",
          isHe ? "font-jbmono text-[#7C8EA3]" : "text-paper/40"
        )}
      >
        {items.map((item, i) => (
          <span key={item.label} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden>/</span>}
            {item.href ? (
              <Link href={withLocale(locale, item.href)} className={cn("transition-colors", isHe ? "hover:text-gold" : "hover:text-gold-light")}>
                {item.label}
              </Link>
            ) : (
              <span className={isHe ? "text-[#A9B8C9]" : "text-paper/60"}>{item.label}</span>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}
