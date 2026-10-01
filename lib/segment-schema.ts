import { SITE_URL } from "@/lib/site";
import { orgRef } from "@/lib/schema";
import type { Locale, SegmentContent } from "@/content";

/**
 * Structured data for a "who it's for" page: the Service, aimed at the profile
 * (`audience`), and the page's own FAQ. Before the 2.10.2026 rewrite these pages had
 * no schema at all, and 110 to 190 words of copy (SEO/GEO audit, item 11).
 */
export function segmentSchemas({
  locale,
  path,
  content,
}: {
  locale: Locale;
  path: string;
  content: SegmentContent;
}) {
  const url = `${SITE_URL}/${locale}${path}`;
  const service = {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${url}#service`,
    serviceType: "Personal Operations Management",
    name: content.metaTitle.replace(/\s*\|\s*Ankora$/, ""),
    description: content.directAnswer,
    provider: orgRef,
    areaServed: { "@type": "Country", name: "Israel" },
    audience: { "@type": "Audience", audienceType: content.eyebrow },
    url,
    inLanguage: locale,
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    mainEntity: content.faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  return { service, faq };
}
