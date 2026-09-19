import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SegmentPage } from "@/components/sections/SegmentPage";

const meta = {
  en: {
    title: "Operational Support for Growing Companies | Ankora",
    description:
      "Ongoing operational and vendor management for growing companies in Israel: a dedicated Operations Manager backed by AI orchestration, without hiring an in-house office manager.",
  },
  he: {
    title: "תמיכה תפעולית לחברות בצמיחה | Ankora",
    description:
      "ניהול ספקים ותפעול שוטף לחברות בצמיחה בישראל, מנהל תפעול ייעודי בגיבוי תזמור AI, בלי לגייס מנהל משרד פנימי.",
  },
} as const;

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const m = meta[locale];
  return {
    title: m.title,
    description: m.description,
    alternates: {
      canonical: `/${locale}/solutions/companies`,
      languages: { he: "/he/solutions/companies", en: "/en/solutions/companies" },
    },
    openGraph: {
      title: m.title,
      description: m.description,
      type: "website",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  return (
    <SegmentPage
      content={dict.pages.segments.companies}
      locale={locale}
      cta={dict.hero.ctaPrimary}
      currentHref="/solutions/companies"
      solutionsMenu={dict.nav.solutionsMenu}
      crossLinkLabel={locale === "he" ? "פתרונות נוספים" : "More Solutions"}
    />
  );
}
