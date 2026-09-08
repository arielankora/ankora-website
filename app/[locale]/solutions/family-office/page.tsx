import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SegmentPage } from "@/components/sections/SegmentPage";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  return {
    alternates: {
      canonical: `/${locale}/solutions/family-office`,
      languages: { he: "/he/solutions/family-office", en: "/en/solutions/family-office" },
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  return <SegmentPage content={dict.pages.segments.familyOffice} locale={locale} cta={dict.hero.ctaPrimary} />;
}
