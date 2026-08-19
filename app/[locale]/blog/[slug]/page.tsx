import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getDictionary, type Locale } from "@/content";
import { getPostBySlug, getAllPostSlugs, getRelatedPosts, coverPositionClass } from "@/lib/blog";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { BlogCard } from "@/components/sections/BlogCard";
import { Reveal } from "@/components/motion/Reveal";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateStaticParams({ params }: { params: { locale: string } }) {
  const locale = params.locale === "en" ? "en" : "he";
  return getAllPostSlugs(locale).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const locale = params.locale === "en" ? "en" : "he";
  const post = getPostBySlug(locale as Locale, params.slug);
  if (!post) return {};

  return {
    title: `${post.title} | Ankora Blog`,
    description: post.excerpt,
    alternates: {
      canonical: `/${locale}/blog/${post.slug}`,
    },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt || post.publishedAt,
      ...(post.coverImage ? { images: [post.coverImage] } : {}),
    },
  };
}

function formatDate(dateStr: string, locale: Locale) {
  try {
    return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

export default function BlogPostPage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const post = getPostBySlug(locale, params.slug);

  if (!post || post.draft) notFound();

  const related = getRelatedPosts(locale, post);
  const base = "https://ankora.co.il";
  const categoryLabel = dict.blog.categories[post.category] || post.category;

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    ...(post.coverImage ? { image: post.coverImage } : {}),
    author: { "@type": "Organization", name: post.author || "Ankora", url: base },
    publisher: {
      "@type": "Organization",
      name: "Ankora",
      logo: { "@type": "ImageObject", url: `${base}/logo.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${base}/${locale}/blog/${post.slug}` },
  };

  return (
    <>
      <JsonLd id="blogpost-schema" data={articleSchema} />

      <section className="relative overflow-hidden bg-ink pb-16 pt-40 md:pb-20 md:pt-48">
        <div className="absolute inset-0 bg-radial-glow opacity-70" />
        <Container className="relative">
          <Breadcrumbs
            locale={locale}
            items={[
              { label: dict.blog.eyebrow, href: "/blog" },
              { label: post.title },
            ]}
          />
          <Reveal delay={0.06} className="mt-8">
            <Badge>{categoryLabel}</Badge>
          </Reveal>
          <Reveal delay={0.12}>
            <h1 className="mt-6 max-w-3xl text-[30px] font-medium leading-[1.2] tracking-tight text-paper md:text-[46px]">
              {post.title}
            </h1>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-paper/50">
              <span>{post.author}</span>
              <span aria-hidden>·</span>
              <span>{formatDate(post.publishedAt, locale)}</span>
              <span aria-hidden>·</span>
              <span>
                {post.readingMinutes} {dict.blog.minRead}
              </span>
            </div>
          </Reveal>
        </Container>
      </section>

      {post.coverImage && (
        <section className="bg-paper">
          {/* Deliberately not <Container> here: Container's own max-w-content
              (1440px) and this max-w-3xl have equal CSS specificity, and
              clsx doesn't dedupe conflicting Tailwind utilities, so
              max-w-content was silently winning and rendering this image
              far wider than the article text column below it. */}
          <div className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-14 lg:px-14">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.coverImage}
              alt={post.title}
              className={`w-full rounded-2xl object-cover ${coverPositionClass(post.coverImagePosition)}`}
              style={{ maxHeight: 520 }}
            />
          </div>
        </section>
      )}

      <section className={post.coverImage ? "bg-paper pb-20 md:pb-28" : "bg-paper py-16 md:py-24"}>
        <Container className="max-w-3xl">
          <div className="blog-article">
            <MDXRemote source={post.content} />
          </div>

          <div className="mt-16">
            <Button href={withLocale(locale, "/blog")} variant="secondary">
              {dict.blog.backToBlog}
            </Button>
          </div>
        </Container>
      </section>

      {related.length > 0 && (
        <section className="border-t border-lineDark bg-paper py-16 md:py-20">
          <Container>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-navy/35">
              {dict.blog.relatedTitle}
            </span>
            <div className="mt-6 grid gap-6 md:grid-cols-3">
              {related.map((p) => (
                <BlogCard key={`${p.locale}-${p.slug}`} post={p} dict={dict} locale={locale} />
              ))}
            </div>
          </Container>
        </section>
      )}

      <section className="relative overflow-hidden bg-ink py-24 md:py-32">
        <div className="absolute inset-0 bg-radial-glow" />
        <Container className="relative text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-[28px] font-medium leading-[1.15] tracking-tight text-paper md:text-[40px]">
              {dict.finalCta.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-md text-paper/55">{dict.finalCta.body}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{dict.finalCta.cta}</Button>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
