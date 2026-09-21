import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SegmentPage } from "@/components/sections/SegmentPage";
import { getStoriesForSolution } from "@/lib/customer-stories";

const meta = {
  en: {
    title: "Personal Operations Management for Family Offices | Ankora",
    description:
      "An operational layer for family offices in Israel: one dedicated Operations Manager coordinating property, vendors, travel and family logistics across several households, alongside your existing structure.",
  },
  he: {
    title: "ניהול תפעול אישי למשרדי משפחה | Ankora",
    description:
      "רובד תפעולי למשרדי משפחה בישראל: מנהל תפעול ייעודי אחד שמתאם נכסים, ספקים, נסיעות ולוגיסטיקה משפחתית על פני כמה בתי אב, לצד המבנה הקיים שלכם.",
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
      canonical: `/${locale}/solutions/family-office`,
      languages: { he: "/he/solutions/family-office", en: "/en/solutions/family-office" },
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
      dict={dict}
      content={dict.pages.segments.familyOffice}
      locale={locale}
      cta={dict.hero.ctaPrimary}
      currentHref="/solutions/family-office"
      stories={getStoriesForSolution(locale, "/solutions/family-office", 2)}
    />
  );
}
