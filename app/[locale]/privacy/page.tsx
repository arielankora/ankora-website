import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { LegalPage } from "@/components/sections/LegalPage";

const PAGE = "privacy" as const;
const PATH = "/privacy";

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const doc = getDictionary(params.locale).pages.legal.pages[PAGE];
  return {
    title: `${doc.title} | Ankora`,
    description: doc.sub,
    alternates: {
      canonical: `/${locale}${PATH}`,
      languages: { he: `/he${PATH}`, en: `/en${PATH}` },
    },
    openGraph: {
      title: `${doc.title} | Ankora`,
      description: doc.sub,
      type: "website",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  return <LegalPage dict={getDictionary(locale)} locale={locale} page={PAGE} />;
}
