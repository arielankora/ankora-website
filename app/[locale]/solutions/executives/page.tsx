import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SegmentPage } from "@/components/sections/SegmentPage";

const meta = {
  en: {
    title: "Personal Operations Management for Executives | Ankora",
    description:
      "An outsourced Personal Operations Management service for senior executives in Israel: a dedicated Operations Manager who owns vendors, travel, personal administration and scheduling end to end, without hiring another full-time assistant.",
  },
  he: {
    title: "ניהול תפעול אישי למנהלים בכירים | Ankora",
    description:
      "שירות חיצוני לניהול תפעול אישי למנהלים בכירים בישראל: מנהל תפעול ייעודי שלוקח אחריות על ספקים, נסיעות, מנהלה ותיאומים, בלי לגייס עובד נוסף.",
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
      canonical: `/${locale}/solutions/executives`,
      languages: { he: "/he/solutions/executives", en: "/en/solutions/executives" },
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
      content={dict.pages.segments.executives}
      locale={locale}
      cta={dict.hero.ctaPrimary}
      currentHref="/solutions/executives"
    />
  );
}
