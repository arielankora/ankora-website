import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { AnkoraVsAiAssistantsPage } from "@/components/sections/AnkoraVsAiAssistantsPage";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  const p = dict.pages.ankoraVsAiAssistants;
  return {
    title: `${p.title} | Ankora`,
    description: p.directAnswer,
    alternates: {
      canonical: `/${locale}/ankora-vs-ai-assistants`,
      languages: { he: "/he/ankora-vs-ai-assistants", en: "/en/ankora-vs-ai-assistants" },
    },
    openGraph: {
      title: `${p.title} | Ankora`,
      description: p.directAnswer,
      type: "article",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.ankoraVsAiAssistants;

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
    url: `${SITE_URL}/${locale}/ankora-vs-ai-assistants`,
  };

  return (
    <>
      <JsonLd id="avai-service-schema" data={serviceSchema} />
      <JsonLd id="avai-faq-schema" data={faqSchema} />
      <AnkoraVsAiAssistantsPage dict={dict} locale={locale} />
    </>
  );
}
