import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import HowItWorksClient from "./HowItWorksClient";

const meta = {
  en: {
    title: "How Personal Operations Management Works | Ankora",
    description:
      "How Ankora's Personal Operations Management works: request, a dedicated human Operations Manager, AI orchestration, execution and proactive follow-up, end to end. For executives, founders and busy families in Israel.",
  },
  he: {
    title: "איך עובד ניהול תפעול אישי אצל Ankora | Ankora",
    description:
      "איך עובד ניהול תפעול אישי אצל Ankora: בקשה, מנהל תפעול אנושי ייעודי, תזמור AI, ביצוע ומעקב יזום. שירות חיצוני למנהלים, יזמים ומשפחות עסוקות בישראל, מקצה לקצה.",
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
      canonical: `/${locale}/how-it-works`,
      languages: { he: "/he/how-it-works", en: "/en/how-it-works", "x-default": "/he/how-it-works" },
    },
    openGraph: {
      ...ogBase(locale, `/how-it-works`),
      title: m.title,
      description: m.description,
      type: "website",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  return <HowItWorksClient params={params} />;
}
