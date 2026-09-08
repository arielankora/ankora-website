import type { Metadata } from "next";
import RoiClient from "./RoiClient";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  return {
    alternates: {
      canonical: `/${locale}/roi`,
      languages: { he: "/he/roi", en: "/en/roi" },
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  return <RoiClient params={params} />;
}
