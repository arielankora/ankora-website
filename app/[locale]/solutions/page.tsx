import type { Metadata } from "next";
import SolutionsIndexClient from "./SolutionsIndexClient";

const meta = {
  en: {
    title: "Personal Operations Management — Who It's For | Ankora",
    description:
      "Ankora provides Personal Operations Management, an outsourced alternative to hiring another assistant, for executives, founders, growing companies and family offices in Israel.",
  },
  he: {
    title: "ניהול תפעול אישי - עבור מי | Ankora",
    description:
      "Ankora מספקת ניהול תפעול אישי, חלופה חיצונית להעסקת עוד עוזר או עובד, למנהלים בכירים, יזמים, חברות בצמיחה ומשרדי משפחה בישראל.",
  },
} as const;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  const m = meta[locale];
  return {
    title: m.title,
    description: m.description,
    alternates: {
      canonical: `/${locale}/solutions`,
      languages: { he: "/he/solutions", en: "/en/solutions" },
    },
    openGraph: {
      title: m.title,
      description: m.description,
      type: "website",
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  return <SolutionsIndexClient params={params} />;
}
