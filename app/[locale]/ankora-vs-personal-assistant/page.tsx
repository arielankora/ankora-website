import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { AnkoraVsPersonalAssistantPage } from "@/components/sections/AnkoraVsPersonalAssistantPage";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  const p = dict.pages.ankoraVsPersonalAssistant;
  return {
    title: `${p.title} | Ankora`,
    description: p.directAnswer,
    alternates: {
      canonical: `/${locale}/ankora-vs-personal-assistant`,
      languages: { he: "/he/ankora-vs-personal-assistant", en: "/en/ankora-vs-personal-assistant" },
    },
    openGraph: {
      title: `${p.title} | Ankora`,
      description: p.directAnswer,
      type: "article",
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.ankoraVsPersonalAssistant;

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
    provider: { "@type": "Organization", name: "Ankora", url: SITE_URL },
    areaServed: "IL",
    description: p.directAnswer,
    url: `${SITE_URL}/${locale}/ankora-vs-personal-assistant`,
  };

  return (
    <>
      <JsonLd id="avpa-service-schema" data={serviceSchema} />
      <JsonLd id="avpa-faq-schema" data={faqSchema} />
      <AnkoraVsPersonalAssistantPage dict={dict} locale={locale} />
    </>
  );
}
