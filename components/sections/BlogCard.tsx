import Link from "next/link";
import Image from "next/image";
import type { Dictionary, Locale } from "@/content";
import { coverPositionClass, type BlogPostMeta } from "@/lib/blog-shared";
import { withLocale } from "@/lib/nav";

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

// /he redesign card: sharp corners (radius 0), hairline border instead of rounded +
// lineDark, gold mono category label + meta row (matches the design spec's mono
// caption treatment used elsewhere), same cover image + fallback behaviour as /en.
function HeBlogCard({ post, dict, locale }: { post: BlogPostMeta; dict: Dictionary; locale: Locale }) {
  const categoryLabel = dict.blog.categories[post.category] || post.category;
  return (
    <Link
      href={withLocale(locale, `/blog/${post.slug}`)}
      className="group flex h-full flex-col overflow-hidden border border-[rgba(243,234,219,0.14)] bg-[rgba(11,27,51,0.5)] backdrop-blur-[12px] transition-colors hover:border-gold/50"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[rgba(243,234,219,0.04)]">
        {post.coverImage ? (
          /* The whole card is one <Link>, and its accessible name concatenates every
             descendant text node including image alt text. The post title is already the
             visible <h3> a few lines down, so the cover image is marked decorative (alt="")
             here to avoid the title being announced/read twice for the same link. */
          <Image
            src={post.coverImage}
            alt=""
            fill
            className={`object-cover transition-transform duration-500 group-hover:scale-[1.03] ${coverPositionClass(post.coverImagePosition)}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-jbmono text-[11px] tracking-[0.15em] text-[#7C8EA3]">ANKORA</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-6">
        <span className="font-jbmono text-[11px] tracking-[0.15em] text-gold">{categoryLabel}</span>
        <h3 className="mt-3 text-[clamp(1.1rem,1.6vw,1.34rem)] font-light leading-snug text-cream transition-colors group-hover:text-gold">
          {post.title}
        </h3>
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[#A9B8C9]">{post.excerpt}</p>
        <div className="mt-auto flex items-center gap-3 pt-5 font-jbmono text-[11px] tracking-[0.1em] text-[#7C8EA3]">
          <span>{formatDate(post.publishedAt, locale)}</span>
          <span aria-hidden>·</span>
          <span>
            {post.readingMinutes} {dict.blog.minRead}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function BlogCard({
  post,
  dict,
  locale,
}: {
  post: BlogPostMeta;
  dict: Dictionary;
  locale: Locale;
}) {
  if (locale === "he") {
    return <HeBlogCard post={post} dict={dict} locale={locale} />;
  }

  const categoryLabel = dict.blog.categories[post.category] || post.category;
  return (
    <Link
      href={withLocale(locale, `/blog/${post.slug}`)}
      className="group flex flex-col overflow-hidden rounded-2xl border border-lineDark bg-white/60 transition-colors hover:border-gold/50"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-appNavy/5">
        {post.coverImage ? (
          <Image
            src={post.coverImage}
            alt={post.title}
            fill
            className={`object-cover transition-transform duration-500 group-hover:scale-[1.03] ${coverPositionClass(post.coverImagePosition)}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-appNavy/10 to-gold/10">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-appNavy/30">Ankora</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-6">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-dim">{categoryLabel}</span>
        <h3 className="mt-3 text-lg font-medium leading-snug text-appNavy transition-colors group-hover:text-appNavy/80">
          {post.title}
        </h3>
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-appNavy/60">{post.excerpt}</p>
        <div className="mt-auto flex items-center gap-3 pt-5 text-xs text-appNavy/40">
          <span>{formatDate(post.publishedAt, locale)}</span>
          <span aria-hidden>·</span>
          <span>
            {post.readingMinutes} {dict.blog.minRead}
          </span>
        </div>
      </div>
    </Link>
  );
}
