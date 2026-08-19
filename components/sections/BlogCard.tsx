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

export function BlogCard({
  post,
  dict,
  locale,
}: {
  post: BlogPostMeta;
  dict: Dictionary;
  locale: Locale;
}) {
  const categoryLabel = dict.blog.categories[post.category] || post.category;
  return (
    <Link
      href={withLocale(locale, `/blog/${post.slug}`)}
      className="group flex flex-col overflow-hidden rounded-2xl border border-lineDark bg-white/60 transition-colors hover:border-gold/50"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-navy/5">
        {post.coverImage ? (
          <Image
            src={post.coverImage}
            alt={post.title}
            fill
            className={`object-cover transition-transform duration-500 group-hover:scale-[1.03] ${coverPositionClass(post.coverImagePosition)}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-navy/10 to-gold/10">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-navy/30">Ankora</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-6">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-dim">{categoryLabel}</span>
        <h3 className="mt-3 text-lg font-medium leading-snug text-navy transition-colors group-hover:text-navy/80">
          {post.title}
        </h3>
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-navy/60">{post.excerpt}</p>
        <div className="mt-auto flex items-center gap-3 pt-5 text-xs text-navy/40">
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
