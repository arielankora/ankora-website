import Link from "next/link";
import Image from "next/image";
import type { Dictionary, Locale } from "@/content";
import { coverPositionClass, type BlogPostMeta } from "@/lib/blog-shared";
import { withLocale } from "@/lib/nav";
import { MonoLabel } from "@/components/ui/MonoLabel";

/**
 * One component, two variants. The old grid card is gone, and so is its he/en fork.
 *
 * `row` is the index row: an editorial list rather than a card grid. There are two
 * posts; a three-column grid with two cards in it announces that the blog is empty,
 * where a hairline-ruled list of two reads as a list of two. The list is also the
 * site's existing idiom — capabilities, how-it-works steps and the /solutions profile
 * rows are all full-width hairline rows — and it scales to forty posts unchanged.
 *
 * `related` is the same content without dek or image.
 */
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
 * The gold category key, Latin and tracked, derived from the slug rather than authored.
 * `travel-logistics` reads `TRAVEL LOGISTICS`. Deriving it keeps the key and the
 * category from drifting, and adds no copy to review in two languages.
 */
function categoryKey(slug: string) {
  return slug.replace(/-/g, " ").toUpperCase();
}

export function BlogCard({
  post,
  dict,
  locale,
  variant = "row",
}: {
  post: BlogPostMeta;
  dict: Dictionary;
  locale: Locale;
  variant?: "row" | "related";
}) {
  const href = withLocale(locale, `/blog/${post.slug}`);

  if (variant === "related") {
    return (
      <Link
        href={href}
        className="group flex min-h-[56px] flex-col gap-2 bg-navy px-5 py-[18px] outline outline-1 outline-[rgba(243,234,219,0.11)] transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.04)] sm:flex-row sm:items-center sm:justify-between sm:gap-5"
      >
        <span className="flex flex-col gap-1.5">
          <MonoLabel script="latin" size={10} tracking="0.12em" className="text-gold">
            {categoryKey(post.category)}
          </MonoLabel>
          <span className="text-[1.08rem] font-normal leading-[1.35] text-cream transition-colors group-hover:text-gold">
            {post.title}
          </span>
        </span>
        <MonoLabel size={10} className="flex-none text-muted">
          {formatDate(post.publishedAt, locale)}
        </MonoLabel>
      </Link>
    );
  }

  return (
    // The link wraps the title only, so the accessible name is the title; the row is
    // made clickable with the stretched-link pattern already used on /solutions.
    <article className="group relative grid gap-[clamp(24px,4vw,56px)] border-b border-[rgba(243,234,219,0.12)] py-[clamp(26px,3.4vw,40px)] sm:grid-cols-[minmax(0,1fr)_230px]">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <MonoLabel script="latin" size={10} tracking="0.12em" className="text-gold">
            {categoryKey(post.category)}
          </MonoLabel>
          <MonoLabel size={10} aria-hidden className="text-line">
            ·
          </MonoLabel>
          <MonoLabel size={10} className="text-muted">
            {formatDate(post.publishedAt, locale)}
          </MonoLabel>
          <MonoLabel size={10} aria-hidden className="text-line">
            ·
          </MonoLabel>
          <MonoLabel size={10} className="text-muted">
            {post.readingMinutes} {dict.blog.minRead}
          </MonoLabel>
        </div>

        <h2 className="mt-3 text-[clamp(1.3rem,2vw,1.72rem)] font-light leading-[1.3] text-cream">
          <Link
            href={href}
            className="transition-colors duration-200 after:absolute after:inset-0 after:content-[''] group-hover:text-gold"
          >
            {post.title}
          </Link>
        </h2>

        <p className="mt-3 line-clamp-3 max-w-[64ch] font-assistant text-[16px] font-light leading-[1.7] text-muted">
          {post.excerpt}
        </p>

        <MonoLabel
          size={10}
          aria-hidden
          className="mt-4 block text-gold transition-colors group-hover:text-gold-light"
        >
          {dict.blog.readMore} {locale === "he" ? "←" : "→"}
        </MonoLabel>
      </div>

      {/* A post without an image omits the element and the row becomes single-column.
          An empty frame is worse than no frame. */}
      {post.coverImage && (
        <div className="relative aspect-[16/10] w-full overflow-hidden outline outline-1 outline-[rgba(243,234,219,0.11)]">
          <Image
            src={post.coverImage}
            alt=""
            fill
            sizes="230px"
            className={`object-cover ${coverPositionClass(post.coverImagePosition)}`}
          />
        </div>
      )}
    </article>
  );
}
