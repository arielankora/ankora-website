import type { Metadata } from "next";
import PricingClient from "./PricingClient";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  return {
    alternates: {
      canonical: `/${locale}/pricing`,
      languages: { he: "/he/pricing", en: "/en/pricing" },
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  return <PricingClient params={params} />;
}
