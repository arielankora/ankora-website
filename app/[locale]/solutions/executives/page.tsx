import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import { getDictionary, type Locale } from "@/content";
import { SegmentPage } from "@/components/sections/SegmentPage";
import { JsonLd } from "@/components/seo/JsonLd";
import { getStoriesForSolution } from "@/lib/customer-stories";
import { segmentSchemas } from "@/lib/segment-schema";

const PATH = "/solutions/executives";

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const c = getDictionary(locale).pages.segments.executives;
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    alternates: {
      canonical: `/${locale}${PATH}`,
      languages: { he: `/he${PATH}`, en: `/en${PATH}`, "x-default": `/he${PATH}` },
    },
    openGraph: {
      ...ogBase(locale, PATH),
      title: c.metaTitle,
      description: c.metaDescription,
      type: "website",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const content = dict.pages.segments.executives;
  const { service, faq } = segmentSchemas({ locale, path: PATH, content });
  return (
    <>
      <JsonLd id="segment-service-schema" data={service} />
      <JsonLd id="segment-faq-schema" data={faq} />
      <SegmentPage
        dict={dict}
        content={content}
        locale={locale}
        cta={dict.hero.ctaPrimary}
        currentHref={PATH}
        stories={getStoriesForSolution(locale, PATH, 2)}
      />
    </>
  );
}
