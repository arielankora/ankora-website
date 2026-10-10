import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import PricingClient from "./PricingClient";
import { getDictionary, type Locale } from "@/content";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPageNode, orgRef } from "@/lib/schema";
import { SITE_URL } from "@/lib/site";

const meta = {
  en: {
    title: "Pricing | Ankora Personal Operations Management",
    description:
      "How Ankora prices Personal Operations Management: pay only for time actually worked, with no salary, pension or employer overhead, unlike hiring a full-time personal assistant.",
  },
  he: {
    title: "תמחור | ניהול תפעול אישי מבית Ankora",
    description:
      "איך Ankora מתמחרת ניהול תפעול אישי: תשלום רק על זמן עבודה בפועל, בלי שכר, פנסיה או עלויות מעסיק, בשונה מהעסקת עוזר אישי במשרה מלאה.",
  },
} as const;

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const m = meta[locale];
  return {
    title: m.title,
    description: m.description,
    alternates: {
      canonical: `/${locale}/pricing`,
      languages: { he: "/he/pricing", en: "/en/pricing", "x-default": "/he/pricing" },
    },
    openGraph: {
      ...ogBase(locale, `/pricing`),
      title: m.title,
      description: m.description,
      type: "website",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const p = getDictionary(locale).pages.pricing;
  const url = `${SITE_URL}/${locale}/pricing`;
  // Offers built from the same tier items the page shows. price is the monthly
  // package total; the UnitPriceSpecification carries the hourly rate.
  const offersSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Personal Operations Management",
    name: p.title,
    provider: orgRef,
    areaServed: "IL",
    url,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: p.tiers.title,
      itemListElement: p.tiers.items.map((tier) => ({
        "@type": "Offer",
        name: tier.name,
        description: `${tier.hours}. ${tier.blurb}`,
        price: tier.hoursPerMonth * tier.hourlyRate,
        priceCurrency: "ILS",
        url,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: tier.hourlyRate,
          priceCurrency: "ILS",
          unitCode: "HUR",
          referenceQuantity: {
            "@type": "QuantitativeValue",
            value: 1,
            unitCode: "HUR",
          },
          valueAddedTaxIncluded: false,
        },
      })),
    },
  };
  return (
    <>
      <JsonLd id="faq-schema" data={faqPageNode(p.faq.items)} />
      <JsonLd id="offers-schema" data={offersSchema} />
      <PricingClient params={params} />
    </>
  );
}
