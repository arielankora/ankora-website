import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { PersonalAssistantForExecutivesPage } from "@/components/sections/PersonalAssistantForExecutivesPage";
import { JsonLd } from "@/components/seo/JsonLd";
import { articleNode, orgRef } from "@/lib/schema";

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  const p = dict.pages.personalAssistantForExecutives;
  return {
    title: p.metaTitle ?? `${p.eyebrow} | Ankora`,
    description: p.metaDescription ?? p.directAnswer,
    alternates: {
      canonical: `/${locale}/personal-assistant-for-executives`,
      languages: { he: "/he/personal-assistant-for-executives", en: "/en/personal-assistant-for-executives", "x-default": "/he/personal-assistant-for-executives" },
    },
    openGraph: {
      ...ogBase(locale, `/personal-assistant-for-executives`),
      title: p.metaTitle ?? `${p.eyebrow} | Ankora`,
      description: p.metaDescription ?? p.directAnswer,
      type: "article",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.personalAssistantForExecutives;

  // Dates for search engines and AI models: when the page first went live
  // (authored) and when its content last changed (git, see lib/schema.ts).
  const articleSchema = articleNode({
    locale,
    path: "/personal-assistant-for-executives",
    headline: p.metaTitle ?? p.eyebrow,
    description: p.metaDescription ?? p.directAnswer,
    datePublished: "2026-08-17",
    modifiedFallback: dict.pages.seo.updatedISO,
  });

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: p.faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Personal Operations Management",
    name: p.eyebrow,
    provider: orgRef,
    areaServed: "IL",
    description: p.directAnswer,
    url: `${SITE_URL}/${locale}/personal-assistant-for-executives`,
  };

  return (
    <>
      <JsonLd id="pafe-service-schema" data={serviceSchema} />
      <JsonLd id="pafe-faq-schema" data={faqSchema} />
      <JsonLd id="pafe-article-schema" data={articleSchema} />
      <PersonalAssistantForExecutivesPage dict={dict} locale={locale} />
    </>
  );
}
