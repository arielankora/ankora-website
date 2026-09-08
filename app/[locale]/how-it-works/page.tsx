import type { Metadata } from "next";
import HowItWorksClient from "./HowItWorksClient";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  return {
    alternates: {
      canonical: `/${locale}/how-it-works`,
      languages: { he: "/he/how-it-works", en: "/en/how-it-works" },
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  return <HowItWorksClient params={params} />;
}
