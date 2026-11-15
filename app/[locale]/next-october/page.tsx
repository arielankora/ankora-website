import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import { type Locale } from "@/content";
import { getNextOctoberContent } from "@/content/next-october";
import { NextOctoberMemorialPage } from "@/components/sections/next-october/NextOctoberMemorialPage";

const PATH = "/next-october";

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const { meta } = getNextOctoberContent(locale);
  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: `/${locale}${PATH}`,
      languages: { he: `/he${PATH}`, en: `/en${PATH}`, "x-default": `/he${PATH}` },
    },
    openGraph: {
      ...ogBase(locale, PATH),
      title: meta.title,
      description: meta.description,
      type: "website",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  return <NextOctoberMemorialPage locale={locale} />;
}
