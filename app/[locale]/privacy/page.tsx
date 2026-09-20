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
  const dict = getDictionary(params.locale);
  const legal = dict.pages.legal;
  return {
    title: `${legal.privacyTitle} | Ankora`,
    description: legal.placeholder,
    alternates: {
      canonical: `/${locale}/privacy`,
      languages: { he: "/he/privacy", en: "/en/privacy" },
    },
    openGraph: {
      title: `${legal.privacyTitle} | Ankora`,
      description: legal.placeholder,
      type: "website",
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
      eyebrow={dict.footer.privacy}
      title={dict.pages.legal.privacyTitle}
      sub={dict.pages.legal.placeholder}
      sections={dict.pages.legal.privacySections}
    />
  );
}
