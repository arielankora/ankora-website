import type { Metadata } from "next";
import CoverageClient from "./CoverageClient";

const meta = {
  en: {
    title: "Areas of Coverage: Vendors, Travel & Administration | Ankora",
    description:
      "What Ankora's Personal Operations Management covers for clients in Israel: vendors, travel, personal administration, household matters, bureaucracy and selected business operations, owned end to end by a dedicated Operations Manager.",
  },
  he: {
    title: "תחומי פעולה: ספקים, נסיעות ומנהלה | Ankora",
    description:
      "מה ניהול התפעול האישי של Ankora מכסה עבור לקוחות בישראל: ספקים, נסיעות, מנהלה אישית, ענייני בית, בירוקרטיה ותפעול עסקי נבחר, באחריות מלאה של מנהל תפעול ייעודי.",
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
      canonical: `/${locale}/coverage`,
      languages: { he: "/he/coverage", en: "/en/coverage" },
    },
    openGraph: {
      title: m.title,
      description: m.description,
      type: "website",
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  return <CoverageClient params={params} />;
}
