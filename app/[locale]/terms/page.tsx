import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { LegalPage } from "@/components/sections/LegalPage";

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  return {
    alternates: {
      canonical: `/${locale}/terms`,
      languages: { he: "/he/terms", en: "/en/terms" },
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  return (
    <LegalPage
      dict={dict}
      locale={locale}
      eyebrow={dict.footer.terms}
      title={dict.pages.legal.termsTitle}
      sections={dict.pages.legal.termsSections}
    />
  );
}
