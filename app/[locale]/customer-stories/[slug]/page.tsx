import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { storiesUi } from "@/content/customer-stories/ui";
import { getAllStories, getAllStorySlugs, getStoryBySlug } from "@/lib/customer-stories";
import { CustomerStoryPage } from "@/components/sections/CustomerStoryPage";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateStaticParams({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  return getAllStorySlugs(locale).map((slug) => ({ slug }));
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const story = getStoryBySlug(locale, params.slug);
  if (!story) return {};
  const ui = storiesUi(locale);

  const title = `${story.headline} | ${ui.eyebrow} | Ankora`;
  return {
    title,
    description: story.summary,
    alternates: {
      canonical: `/${locale}/customer-stories/${story.slug}`,
      languages: {
        he: `/he/customer-stories/${story.slug}`,
        en: `/en/customer-stories/${story.slug}`,
      },
    },
    openGraph: {
      title,
      description: story.summary,
      type: "article",
      locale: locale === "he" ? "he_IL" : "en_US",
      publishedTime: story.publishedDate,
      modifiedTime: story.updatedDate || story.publishedDate,
      ...(story.image ? { images: [story.image.src] } : {}),
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string; slug: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const story = getStoryBySlug(locale, params.slug);
  if (!story) notFound();

  const others = getAllStories(locale).filter((s) => s.slug !== story.slug);
  const base = SITE_URL;
  const url = `${base}/${locale}/customer-stories/${story.slug}`;

  /**
   * Article about a named Person, published by Ankora. The customer is the subject
   * (about), never the author - the account is written by Ankora, and saying otherwise
   * would misattribute it. No Review or AggregateRating: see the hub's note.
   */
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: story.headline,
    description: story.summary,
    inLanguage: locale === "he" ? "he-IL" : "en",
    datePublished: story.publishedDate,
    dateModified: story.updatedDate || story.publishedDate,
    ...(story.image ? { image: `${base}${story.image.src}` } : {}),
    author: { "@type": "Organization", name: "Ankora", url: base },
    publisher: {
      "@type": "Organization",
      name: "Ankora",
      url: base,
      logo: { "@type": "ImageObject", url: `${base}/logo.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    about: {
      "@type": "Person",
      name: story.customerName,
      ...(story.customerRole ? { jobTitle: story.customerRole } : {}),
      ...(story.customerCompany
        ? { worksFor: { "@type": "Organization", name: story.customerCompany } }
        : {}),
      // The customer's own public post is the one third-party reference we can point
      // at. sameAs is only ever the customer's own property, never an Ankora page.
      ...(story.independentEvidence ? { sameAs: [story.independentEvidence.url] } : {}),
    },
    mentions: {
      "@type": "Service",
      serviceType: "Personal Operations Management",
      name: "Ankora Personal Operations Management",
      provider: { "@type": "Organization", name: "Ankora", url: base },
      areaServed: "IL",
      url: `${base}/${locale}/personal-operations-management`,
    },
    ...(story.independentEvidence
      ? { citation: { "@type": "CreativeWork", url: story.independentEvidence.url } }
      : {}),
  };

  return (
    <>
      <JsonLd id="customer-story-schema" data={articleSchema} />
      <CustomerStoryPage dict={dict} locale={locale} story={story} otherStories={others} />
    </>
  );
}
