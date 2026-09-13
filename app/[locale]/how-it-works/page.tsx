import type { Metadata } from "next";
import HowItWorksClient from "./HowItWorksClient";

const meta = {
  en: {
    title: "How Personal Operations Management Works | Ankora",
    description:
      "How Ankora's Personal Operations Management works: request, a dedicated human Operations Manager, AI orchestration, execution and proactive follow-up — an outsourced service for executives, founders and busy families in Israel, end to end.",
  },
  he: {
    title: "איך עובד ניהול תפעול אישי אצל Ankora | Ankora",
    description:
      "איך עובד ניהול תפעול אישי אצל Ankora: בקשה, מנהל תפעול אנושי ייעודי, תזמור AI, ביצוע ומעקב יזום. שירות חיצוני למנהלים, יזמים ומשפחות עסוקות בישראל, מקצה לקצה.",
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
      canonical: `/${locale}/how-it-works`,
      languages: { he: "/he/how-it-works", en: "/en/how-it-works" },
    },
    openGraph: {
      title: m.title,
      description: m.description,
      type: "website",
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  return <HowItWorksClient params={params} />;
}
