import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { AboutPageClient } from "@/components/sections/AboutPageClient";
import { JsonLd } from "@/components/seo/JsonLd";
import { orgRef, WEBSITE_ID } from "@/lib/schema";

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  return {
    title: dict.meta.aboutTitle,
    description: dict.meta.aboutDescription,
    alternates: {
      canonical: `/${locale}/about`,
      languages: { he: "/he/about", en: "/en/about", "x-default": "/he/about" },
    },
    openGraph: {
      ...ogBase(locale, `/about`),
      title: dict.meta.aboutTitle,
      description: dict.meta.aboutDescription,
      type: "website",
    },
  };
}

export default async function AboutPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.about;
  const base = SITE_URL;

  // The Organization itself is published once, by the layout (lib/schema.ts).
  // This page is ABOUT it, and says so.
  const aboutSchema = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${base}/${locale}/about#webpage`,
    url: `${base}/${locale}/about`,
    name: dict.meta.aboutTitle,
    description: p.entityDefinition,
    inLanguage: locale,
    about: orgRef,
    mainEntity: orgRef,
    isPartOf: { "@id": WEBSITE_ID },
  };

  return (
    <>
      <JsonLd id="about-page-schema" data={aboutSchema} />
      <AboutPageClient dict={dict} locale={locale} />
    </>
  );
}
