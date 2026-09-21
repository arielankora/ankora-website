import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SegmentPage } from "@/components/sections/SegmentPage";
import { getStoriesForSolution } from "@/lib/customer-stories";

const meta = {
  en: {
    title: "Personal Operations Management for Founders | Ankora",
    description:
      "An outsourced operational layer for founders and entrepreneurs in Israel: a dedicated Operations Manager who owns vendors, admin and personal tasks so you can stay focused on the business, without hiring another role.",
  },
  he: {
    title: "ניהול תפעול אישי ליזמים | Ankora",
    description:
      "רובד תפעולי חיצוני ליזמים בישראל: מנהל תפעול ייעודי שלוקח על עצמו ספקים, מנהלה ומשימות אישיות, כדי שתישארו מרוכזים בעסק, בלי לגייס תפקיד נוסף.",
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
      canonical: `/${locale}/solutions/founders`,
      languages: { he: "/he/solutions/founders", en: "/en/solutions/founders" },
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
      content={dict.pages.segments.founders}
      locale={locale}
      cta={dict.hero.ctaPrimary}
      currentHref="/solutions/founders"
      stories={getStoriesForSolution(locale, "/solutions/founders", 2)}
    />
  );
}
