import type { Metadata } from "next";
import TechnologyClient from "./TechnologyClient";

const meta = {
  en: {
    title: "Human + AI Orchestration | Ankora Technology",
    description:
      "The technology behind Ankora's Personal Operations Management: AI orchestration that remembers your preferences and monitors every open task, working alongside your dedicated human Operations Manager, not instead of one.",
  },
  he: {
    title: "אדם ובינה מלאכותית יחד | טכנולוגיה של Ankora",
    description:
      "הטכנולוגיה מאחורי ניהול התפעול האישי של Ankora: תזמור AI שזוכר העדפות ועוקב אחרי כל משימה פתוחה, לצד מנהל תפעול אנושי ייעודי, לא במקומו.",
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
      canonical: `/${locale}/technology`,
      languages: { he: "/he/technology", en: "/en/technology" },
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
  return <TechnologyClient params={params} />;
}
