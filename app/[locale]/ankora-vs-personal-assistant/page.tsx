import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { AnkoraVsPersonalAssistantPage } from "@/components/sections/AnkoraVsPersonalAssistantPage";
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
  const p = dict.pages.ankoraVsPersonalAssistant;
  return {
    title: `${p.title} | Ankora`,
    description: p.metaDescription ?? p.directAnswer,
    alternates: {
      canonical: `/${locale}/ankora-vs-personal-assistant`,
      languages: { he: "/he/ankora-vs-personal-assistant", en: "/en/ankora-vs-personal-assistant", "x-default": "/he/ankora-vs-personal-assistant" },
    },
    openGraph: {
      ...ogBase(locale, `/ankora-vs-personal-assistant`),
      title: `${p.title} | Ankora`,
      description: p.metaDescription ?? p.directAnswer,
      type: "article",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.ankoraVsPersonalAssistant;

  // Dates for search engines and AI models: when the page first went live
  // (authored) and when its content last changed (git, see lib/schema.ts).
  const articleSchema = articleNode({
    locale,
    path: "/ankora-vs-personal-assistant",
    headline: p.title,
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
    name: p.title,
    provider: orgRef,
    areaServed: "IL",
    description: p.directAnswer,
    url: `${SITE_URL}/${locale}/ankora-vs-personal-assistant`,
  };

  return (
    <>
      <JsonLd id="avpa-service-schema" data={serviceSchema} />
      <JsonLd id="avpa-faq-schema" data={faqSchema} />
      <JsonLd id="avpa-article-schema" data={articleSchema} />
      <AnkoraVsPersonalAssistantPage dict={dict} locale={locale} />
    </>
  );
}
