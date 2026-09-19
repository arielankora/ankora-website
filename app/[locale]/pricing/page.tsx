import type { Metadata } from "next";
import PricingClient from "./PricingClient";

const meta = {
  en: {
    title: "Pricing | Ankora Personal Operations Management",
    description:
      "How Ankora prices Personal Operations Management: pay only for time actually worked, with no salary, pension or employer overhead, unlike hiring a full-time personal assistant.",
  },
  he: {
    title: "תמחור | ניהול תפעול אישי מבית Ankora",
    description:
      "איך Ankora מתמחרת ניהול תפעול אישי: תשלום רק על זמן עבודה בפועל, בלי שכר, פנסיה או עלויות מעסיק, בשונה מהעסקת עוזר אישי במשרה מלאה.",
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
      canonical: `/${locale}/pricing`,
      languages: { he: "/he/pricing", en: "/en/pricing" },
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
  return <PricingClient params={params} />;
}
