import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { AboutPageClient } from "@/components/sections/AboutPageClient";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  return {
    title: dict.meta.aboutTitle,
    description: dict.meta.aboutDescription,
    alternates: {
      canonical: `/${locale}/about`,
      languages: { he: "/he/about", en: "/en/about" },
    },
    openGraph: {
      title: dict.meta.aboutTitle,
      description: dict.meta.aboutDescription,
      type: "website",
    },
  };
}

export default function AboutPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.about;
  const base = "https://ankora.co.il";

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Ankora",
    url: base,
    logo: `${base}/logo.png`,
    description: p.entityDefinition,
    email: "hello@ankora.co.il",
    areaServed: "IL",
    address: { "@type": "PostalAddress", addressLocality: "Tel Aviv", addressCountry: "IL" },
    contactPoint: {
      "@type": "ContactPoint",
      email: "hello@ankora.co.il",
      contactType: "customer service",
      areaServed: "IL",
    },
  };

  return (
    <>
      <JsonLd id="about-organization-schema" data={organizationSchema} />
      <AboutPageClient dict={dict} locale={locale} />
    </>
  );
}
