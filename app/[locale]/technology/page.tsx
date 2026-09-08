import type { Metadata } from "next";
import TechnologyClient from "./TechnologyClient";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  return {
    alternates: {
      canonical: `/${locale}/technology`,
      languages: { he: "/he/technology", en: "/en/technology" },
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  return <TechnologyClient params={params} />;
}
