import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { Hero } from "@/components/sections/Hero";
import { EditorialSection } from "@/components/sections/EditorialSection";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Intelligence } from "@/components/sections/Intelligence";
import { Capabilities } from "@/components/sections/Capabilities";
import { HumanAI } from "@/components/sections/HumanAI";
import { Industries } from "@/components/sections/Industries";
import { Trust } from "@/components/sections/Trust";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  return {
    title: dict.meta.homeTitle,
    description: dict.meta.homeDescription,
    alternates: {
      canonical: `/${locale}`,
      languages: { he: "/he", en: "/en" },
    },
    openGraph: {
      title: dict.meta.homeTitle,
      description: dict.meta.homeDescription,
      type: "website",
    },
  };
}

export default function Home({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const base = "https://ankora.co.il";

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Ankora",
    url: base,
    logo: `${base}/logo.png`,
    description: dict.meta.homeDescription,
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

  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Personal Operations Management",
    name: "Ankora Personal Operations Management",
    provider: { "@type": "Organization", name: "Ankora", url: base },
    areaServed: "IL",
    description: dict.pages.personalOperationsManagement.directAnswer,
    url: `${base}/${locale}/personal-operations-management`,
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: dict.faq.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <JsonLd id="organization-schema" data={organizationSchema} />
      <JsonLd id="service-schema" data={serviceSchema} />
      <JsonLd id="faq-schema" data={faqSchema} />
      <Hero dict={dict} locale={locale} />
      <EditorialSection label={dict.problem.label} title={dict.problem.title} body={dict.problem.body} tone="light" />
      <EditorialSection label={dict.insight.label} title={dict.insight.title} body={dict.insight.body} tone="dark" />
      <EditorialSection label={dict.category.label} title={dict.category.title} body={dict.category.body} tone="light" />
      <HowItWorks dict={dict} />
      <Intelligence dict={dict} />
      <Capabilities dict={dict} />
      <HumanAI dict={dict} />
      <Industries dict={dict} locale={locale} />
      <Trust dict={dict} />
      <FAQ dict={dict} />
      <FinalCTA dict={dict} locale={locale} />
    </>
  );
}
