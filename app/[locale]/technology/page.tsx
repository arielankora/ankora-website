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

export default function Page({ params }: { params: { locale: string } }) {
  return <TechnologyClient params={params} />;
}
