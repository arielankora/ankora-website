import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote-client/rsc";
import { getDictionary, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { getPostBySlug, getAllPostSlugs, getRelatedPosts, coverPositionClass } from "@/lib/blog";
import { withLocale } from "@/lib/nav";
import { WideContainer } from "@/components/ui/WideContainer";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { BlogCard } from "@/components/sections/BlogCard";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { Reveal } from "@/components/motion/Reveal";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateStaticParams({ params }: { params: { locale: string } }) {
  const locale = params.locale === "en" ? "en" : "he";
  return getAllPostSlugs(locale).map((slug) => ({ slug }));
}

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string; slug: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
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


/**
 * Three of the four posts open with an `# ` heading repeating the frontmatter title,
 * so the page rendered two `h1`s and the title twice as body copy. The duplicate is
 * dropped when it matches, and any other `h1` the body might carry is demoted, because
 * the page's own title is the only first-level heading a post can have.
 */
function stripDuplicateTitle(content: string, title: string) {
  const norm = (v: string) => v.replace(/\\/g, "").replace(/\s+/g, " ").trim();
  return content.replace(/^\s*#\s+(.+?)\s*$/m, (match, heading: string) =>
    norm(heading) === norm(title) ? "" : match
  );
}

const MDX_COMPONENTS = {
  h1: (props: React.ComponentProps<"h2">) => <h2 {...props} />,
};

/**
 * A post reads like the rest of the publication: the same reading engine as the three
 * SEO pages, via the `.longform` scope, so a post and a category page feel like one
 * site rather than two.
 *
 * The hero image sits **below** the title, never behind it. Text over photography
 * cannot be contrast-audited, and a right-to-left headline over a left-to-right
 * composition crops wrongly in one of the two locales.
 *
 * This replaces a forked pair, the /he half of which had never been written — the page
 * rendered the pre-redesign cream theme under /he too.
 */
export default async function BlogPostPage(
  props: {
    params: Promise<{ locale: string; slug: string }>;
  }
) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const post = getPostBySlug(locale, params.slug);

  if (!post || post.draft) notFound();

  const related = getRelatedPosts(locale, post);
  const base = SITE_URL;
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

      <section className="relative overflow-hidden pb-10 pt-40 md:pt-48">
        <WideContainer className="relative z-[1]">
          <div className="mx-auto max-w-[900px]">
            <Breadcrumbs
              locale={locale}
              items={[
                { label: dict.nav.home, href: "/" },
                { label: dict.blog.eyebrow, href: "/blog" },
                { label: post.title },
              ]}
            />

            <Reveal delay={0.06}>
              <div className="mt-8">
                <MonoLabel script="latin" size={10} tracking="0.12em" className="text-gold">
                  {post.category.replace(/-/g, " ").toUpperCase()}
                </MonoLabel>
              </div>
            </Reveal>

            <Reveal delay={0.12}>
              <h1 className="mt-4 max-w-[26ch] text-[clamp(1.95rem,3.8vw,3rem)] font-extralight leading-[1.2] tracking-[-0.03em] text-cream">
                {post.title}
              </h1>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                {/* The author is Latin in both dictionaries and keeps its tracking; the
                    date follows the page language and drops it. */}
                <MonoLabel script="latin" className="text-muted">
                  {post.author}
                </MonoLabel>
                <MonoLabel aria-hidden className="text-line">·</MonoLabel>
                <MonoLabel className="text-muted">
                  <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, locale)}</time>
                </MonoLabel>
                <MonoLabel aria-hidden className="text-line">·</MonoLabel>
                <MonoLabel className="text-muted">
                  {post.readingMinutes} {dict.blog.minRead}
                </MonoLabel>
              </div>
            </Reveal>
          </div>
        </WideContainer>
      </section>

      <WideContainer>
        <div className="mx-auto max-w-[900px]">
          {post.coverImage && (
            <Reveal>
              <figure className="m-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.coverImage}
                  alt=""
                  className={`aspect-[16/7] w-full object-cover outline outline-1 outline-[rgba(243,234,219,0.11)] ${coverPositionClass(post.coverImagePosition)}`}
                />
              </figure>
            </Reveal>
          )}

          <div className="longform mt-[clamp(28px,4vw,44px)]">
            <MDXRemote source={stripDuplicateTitle(post.content, post.title)} components={MDX_COMPONENTS} />
          </div>

          <div className="mt-[clamp(40px,5vw,64px)] border-t border-[rgba(243,234,219,0.12)] pt-6">
            <Link
              href={withLocale(locale, "/blog")}
              className="inline-flex min-h-[44px] items-center transition-colors hover:text-gold"
            >
              <MonoLabel className="text-muted transition-colors hover:text-gold">
                {locale === "he" ? "←" : "→"} {dict.blog.backToBlog}
              </MonoLabel>
            </Link>
          </div>

          {related.length > 0 && (
            <section className="mt-[clamp(40px,5vw,64px)] border-t border-[rgba(243,234,219,0.12)] pt-[22px]">
              <MonoLabel size={10} className="text-muted">
                {dict.blog.relatedTitle}
              </MonoLabel>
              <div className="mt-4 flex flex-col gap-px">
                {related.slice(0, 3).map((r) => (
                  <BlogCard key={r.slug} post={r} dict={dict} locale={locale} variant="related" />
                ))}
              </div>
            </section>
          )}
        </div>
      </WideContainer>

      <FinalCTA dict={dict} locale={locale} />
    </>
  );
}
