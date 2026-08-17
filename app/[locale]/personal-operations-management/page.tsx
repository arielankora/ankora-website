import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { PersonalOperationsManagementPage } from "@/components/sections/PersonalOperationsManagementPage";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  const p = dict.pages.personalOperationsManagement;
  return {
    title: `${p.title} | Ankora`,
    description: p.directAnswer,
    alternates: {
      canonical: `/${locale}/personal-operations-management`,
      languages: { he: "/he/personal-operations-management", en: "/en/personal-operations-management" },
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
  const p = dict.pages.personalOperationsManagement;
  const base = "https://ankora.co.il";

  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Personal Operations Management",
    name: p.title,
    provider: { "@type": "Organization", name: "Ankora", url: base },
    areaServed: "IL",
    description: p.directAnswer,
    url: `${base}/${locale}/personal-operations-management`,
  };

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
      <PersonalOperationsManagementPage dict={dict} locale={locale} />
    </>
  );
}
