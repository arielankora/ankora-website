import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { PersonalOperationsManagementPage } from "@/components/sections/PersonalOperationsManagementPage";
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
  const p = dict.pages.personalOperationsManagement;
  return {
    title: `${p.title} | Ankora`,
    description: p.metaDescription ?? p.directAnswer,
    alternates: {
      canonical: `/${locale}/personal-operations-management`,
      languages: { he: "/he/personal-operations-management", en: "/en/personal-operations-management", "x-default": "/he/personal-operations-management" },
    },
    openGraph: {
      ...ogBase(locale, `/personal-operations-management`),
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
  const p = dict.pages.personalOperationsManagement;
  const base = SITE_URL;

  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Personal Operations Management",
    name: p.title,
    provider: orgRef,
    areaServed: "IL",
    description: p.directAnswer,
    url: `${base}/${locale}/personal-operations-management`,
  };

  // Dates for search engines and AI models: when the page first went live
  // (authored) and when its content last changed (git, see lib/schema.ts).
  const articleSchema = articleNode({
    locale,
    path: "/personal-operations-management",
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

  return (
    <>
      <JsonLd id="pom-service-schema" data={serviceSchema} />
      <JsonLd id="pom-faq-schema" data={faqSchema} />
      <JsonLd id="pom-article-schema" data={articleSchema} />
      <PersonalOperationsManagementPage dict={dict} locale={locale} />
    </>
  );
}
