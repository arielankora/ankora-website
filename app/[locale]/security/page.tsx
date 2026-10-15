import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import { type Locale } from "@/content";
import { getSecurityContent, openOnly } from "@/content/security";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPageNode } from "@/lib/schema";
import SecurityPage from "@/components/sections/SecurityPage";

const PATH = "/security";

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const { meta } = getSecurityContent(locale);
  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: `/${locale}${PATH}`,
      languages: { he: `/he${PATH}`, en: `/en${PATH}`, "x-default": `/he${PATH}` },
    },
    openGraph: {
      ...ogBase(locale, PATH),
      title: meta.title,
      description: meta.description,
      type: "website",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  // The schema carries exactly the answers a visitor can open: gated ones stay out of both.
  const faq = openOnly(getSecurityContent(locale).faq.items).map(({ q, a }) => ({ q, a }));
  return (
    <>
      <JsonLd id="faq-schema" data={faqPageNode(faq)} />
      <SecurityPage locale={locale} />
    </>
  );
}
