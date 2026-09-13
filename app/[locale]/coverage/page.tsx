import type { Metadata } from "next";
import CoverageClient from "./CoverageClient";
import { SITE_URL } from "@/lib/site";
import { JsonLd } from "@/components/seo/JsonLd";

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

const pillars = {
  en: [
    { name: "Vendor Management", description: "Sourcing, coordinating and following up with contractors and service providers on the client's behalf." },
    { name: "Travel Management", description: "Planning and booking flights, accommodation and ground logistics for personal and business travel." },
    { name: "Personal Administration", description: "Handling paperwork, renewals, appointments and requests with authorities and institutions." },
    { name: "Household Management", description: "Coordinating repairs, maintenance and day-to-day upkeep for the home." },
    { name: "Bureaucracy & Institutions", description: "Liaising with government offices, banks, insurers and local authorities." },
    { name: "Selected Business Operations", description: "Supporting business-related administrative and operational tasks alongside personal ones." },
  ],
  he: [
    { name: "ניהול ספקים", description: "איתור, תיאום ומעקב מול קבלנים ונותני שירות בשם הלקוח." },
    { name: "ניהול נסיעות", description: "תכנון והזמנה של טיסות, לינה ולוגיסטיקה לנסיעות אישיות ועסקיות." },
    { name: "מנהלה אישית", description: "טיפול בניירת, חידושים, תורים ובקשות מול רשויות ומוסדות." },
    { name: "ניהול משק הבית", description: "תיאום תיקונים, תחזוקה וטיפול שוטף בבית." },
    { name: "בירוקרטיה ומוסדות", description: "ליווי מול משרדי ממשלה, בנקים, חברות ביטוח ורשויות מקומיות." },
    { name: "תפעול עסקי נבחר", description: "תמיכה במשימות מנהלתיות ותפעוליות עסקיות, לצד המשימות האישיות." },
  ],
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
  const locale = params.locale === "en" ? "en" : "he";
  const m = meta[locale];
  const base = SITE_URL;

  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Personal Operations Management",
    name: m.title,
    provider: { "@type": "Organization", name: "Ankora", url: base },
    areaServed: "IL",
    description: m.description,
    url: `${base}/${locale}/coverage`,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: locale === "en" ? "Areas of Coverage" : "תחומי הפעולה",
      itemListElement: pillars[locale].map((item) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: item.name, description: item.description },
      })),
    },
  };

  return (
    <>
      <JsonLd id="coverage-service-schema" data={serviceSchema} />
      <CoverageClient params={params} />
    </>
  );
}
