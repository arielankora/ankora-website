import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { storiesUi } from "@/content/customer-stories/ui";
import { getAllStories } from "@/lib/customer-stories";
import { CustomerStoriesIndexPage } from "@/components/sections/CustomerStoriesIndexPage";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const ui = storiesUi(locale);
  return {
    title: ui.metaTitle,
    description: ui.metaDescription,
    alternates: {
      canonical: `/${locale}/customer-stories`,
      languages: { he: "/he/customer-stories", en: "/en/customer-stories" },
    },
    openGraph: {
      title: ui.metaTitle,
      description: ui.metaDescription,
      type: "website",
      locale: locale === "he" ? "he_IL" : "en_US",
    },
  };
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const ui = storiesUi(locale);
  const stories = getAllStories(locale);
  const base = SITE_URL;

  /**
   * CollectionPage wrapping an ItemList of the published stories. No Review, no
   * AggregateRating, no rating value: this is a list of first-party accounts, not a
   * review corpus, and marking it as one would be a false claim in structured data.
   * BreadcrumbList is emitted by the Breadcrumbs component.
   */
  const collectionSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: ui.h1,
    description: ui.metaDescription,
    url: `${base}/${locale}/customer-stories`,
    inLanguage: locale === "he" ? "he-IL" : "en",
    isPartOf: { "@type": "WebSite", name: "Ankora", url: base },
    about: {
      "@type": "Service",
      serviceType: "Personal Operations Management",
      provider: { "@type": "Organization", name: "Ankora", url: base },
      areaServed: "IL",
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: stories.length,
      itemListElement: stories.map((story, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${base}/${locale}/customer-stories/${story.slug}`,
        name: story.headline,
      })),
    },
  };

  return (
    <>
      <JsonLd id="customer-stories-collection-schema" data={collectionSchema} />
      <CustomerStoriesIndexPage dict={dict} locale={locale} stories={stories} />
    </>
  );
}
