import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import RoiClient from "./RoiClient";

// Both locales get a dedicated title and description, like /contact. /en used to
// fall back to the generic site meta (SEO/GEO audit, 1.10.2026).
const PAGE_META = {
  he: {
    title: "מחשבון ROI | כמה Ankora חוסכת לכם | Ankora",
    description:
      "מחשבון אינטראקטיבי: הזינו את שעות התפעול השבועיות שלכם וקבלו הערכה מיידית של שעות וכסף שאנקורה יכולה לחסוך לכם בחודש.",
  },
  en: {
    title: "ROI Calculator: How Much Time Ankora Gives Back | Ankora",
    description:
      "Enter your weekly hours of operational work and see an instant estimate of the time and money Ankora returns to you each month.",
  },
} as const;

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const meta = PAGE_META[locale];
  return {
    title: meta.title,
    description: meta.description,
    openGraph: {
      ...ogBase(locale, `/roi`), title: meta.title, description: meta.description, type: "website" },
    alternates: {
      canonical: `/${locale}/roi`,
      languages: { he: "/he/roi", en: "/en/roi", "x-default": "/he/roi" },
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  return <RoiClient params={params} />;
}
