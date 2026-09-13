import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { PersonalAssistantForExecutivesPage } from "@/components/sections/PersonalAssistantForExecutivesPage";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  const p = dict.pages.personalAssistantForExecutives;
  return {
    title: `${p.eyebrow} | Ankora`,
    description: p.directAnswer,
    alternates: {
      canonical: `/${locale}/personal-assistant-for-executives`,
      languages: { he: "/he/personal-assistant-for-executives", en: "/en/personal-assistant-for-executives" },
    },
    openGraph: {
      title: `${p.eyebrow} | Ankora`,
      description: p.directAnswer,
      type: "article",
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.personalAssistantForExecutives;

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
    provider: { "@type": "Organization", name: "Ankora", url: SITE_URL },
    areaServed: "IL",
    description: p.directAnswer,
    url: `${SITE_URL}/${locale}/personal-assistant-for-executives`,
  };

  return (
    <>
      <JsonLd id="pafe-service-schema" data={serviceSchema} />
      <JsonLd id="pafe-faq-schema" data={faqSchema} />
      <PersonalAssistantForExecutivesPage dict={dict} locale={locale} />
    </>
  );
}
