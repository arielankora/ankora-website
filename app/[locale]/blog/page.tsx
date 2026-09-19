import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { getAllPosts, BLOG_CATEGORY_SLUGS } from "@/lib/blog";
import { BlogIndexPage } from "@/components/sections/BlogIndexPage";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  return {
    title: `${dict.blog.title} | Ankora`,
    description: dict.blog.sub,
    alternates: {
      canonical: `/${locale}/blog`,
      languages: { he: "/he/blog", en: "/en/blog" },
    },
    openGraph: {
      title: `${dict.blog.title} | Ankora`,
      description: dict.blog.sub,
      type: "website",
    },
  };
}

export default async function BlogPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ category?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const posts = getAllPosts(locale);
  const base = SITE_URL;

  const category =
    searchParams.category && (BLOG_CATEGORY_SLUGS as readonly string[]).includes(searchParams.category)
      ? searchParams.category
      : undefined;

  const blogSchema = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: dict.blog.title,
    description: dict.blog.sub,
    url: `${base}/${locale}/blog`,
    blogPost: posts.slice(0, 20).map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `${base}/${locale}/blog/${p.slug}`,
      datePublished: p.publishedAt,
    })),
  };

  return (
    <>
      <JsonLd id="blog-schema" data={blogSchema} />
      <BlogIndexPage dict={dict} locale={locale} posts={posts} activeCategory={category} />
    </>
  );
}
