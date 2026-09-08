import type { Metadata } from "next";
import SolutionsIndexClient from "./SolutionsIndexClient";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  return {
    alternates: {
      canonical: `/${locale}/solutions`,
      languages: { he: "/he/solutions", en: "/en/solutions" },
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  return <SolutionsIndexClient params={params} />;
}
