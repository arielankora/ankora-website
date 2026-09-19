import type { Metadata } from "next";
import RoiClient from "./RoiClient";

// /he: dedicated title/description so this conversion page doesn't fall back to the
// generic site meta (flagged and fixed per Ariel's production QA pass). /en keeps its
// prior behaviour (no override) -- untouched, per project convention.
const heMeta = {
  title: "מחשבון ROI | כמה Ankora חוסכת לכם | Ankora",
  description:
    "מחשבון אינטראקטיבי: הזינו את שעות התפעול השבועיות שלכם וקבלו הערכה מיידית של שעות וכסף שאנקורה יכולה לחסוך לכם בחודש.",
};

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const meta =
    locale === "he"
      ? { title: heMeta.title, description: heMeta.description }
      : {};
  return {
    ...meta,
    alternates: {
      canonical: `/${locale}/roi`,
      languages: { he: "/he/roi", en: "/en/roi" },
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  return <RoiClient params={params} />;
}
