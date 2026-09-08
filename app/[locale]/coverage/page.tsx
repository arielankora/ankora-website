import type { Metadata } from "next";
import CoverageClient from "./CoverageClient";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  return {
    alternates: {
      canonical: `/${locale}/coverage`,
      languages: { he: "/he/coverage", en: "/en/coverage" },
    },
  };
}

export default function Page({ params }: { params: { locale: string } }) {
  return <CoverageClient params={params} />;
}
