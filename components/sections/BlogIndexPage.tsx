import Link from "next/link";
import type { Dictionary, Locale } from "@/content";
import type { BlogPostMeta } from "@/lib/blog-shared";
import { BLOG_CATEGORY_SLUGS } from "@/lib/blog-shared";
import { withLocale } from "@/lib/nav";
import { plural } from "@/lib/plural";
import { WideContainer } from "@/components/ui/WideContainer";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { BlogCard } from "@/components/sections/BlogCard";
import { SectionShell } from "@/components/ui/SectionShell";
import { cn } from "@/lib/utils";

/**
 * The blog index: an editorial list, not a card grid.
 *
 * The filters are links carrying `?category=`, not pills, chips or buttons — they have
 * to stay crawlable, and a category page that only exists behind a click is a category
 * page search engines cannot see. 13px of vertical padding puts each over 24px without
 * anything visible moving.
 *
 * A server component now: the previous version was a client component only because it
 * held the filter in React state, which is a URL's job.
 */
export function BlogIndexPage({
  dict,
  locale,
  posts,
  activeCategory,
}: {
  dict: Dictionary;
  locale: Locale;
  posts: BlogPostMeta[];
  activeCategory?: string;
}) {
  const b = dict.blog;
  const filtered = activeCategory ? posts.filter((p) => p.category === activeCategory) : posts;
  const activeLabel = activeCategory ? b.categories[activeCategory] || activeCategory : null;

  // px/-mx on top of the vertical padding: the shortest Hebrew filter ("הכל") renders
  // 18px wide, under the 24x24 minimum on width alone -- the same condition that caught
  // the breadcrumb and nav links. The negative margin keeps the row's spacing exactly as
  // designed, so nothing visible moves.
  const filterClass = (isActive: boolean) =>
    cn(
      "border-b px-[5px] py-[13px] -mx-[5px] transition-colors duration-200",
      isActive ? "border-gold text-cream" : "border-transparent text-muted hover:text-gold"
    );

  return (
    <>
      <PageHero
        eyebrow={b.eyebrow}
        title={b.title}
        sub={b.sub}
        breadcrumb={
          <Breadcrumbs
            locale={locale}
            items={[{ label: dict.nav.home, href: "/" }, { label: b.eyebrow }]}
          />
        }
      />

      <SectionShell containerClassName="max-w-[1100px]">
        <div className="flex flex-wrap items-center gap-x-7 border-y border-[rgba(243,234,219,0.12)]">
          <Link href={withLocale(locale, "/blog")} className={filterClass(!activeCategory)}>
            <MonoLabel size={11}>{b.allCategories}</MonoLabel>
          </Link>
          {BLOG_CATEGORY_SLUGS.map((cat) => (
            <Link
              key={cat}
              href={{ pathname: withLocale(locale, "/blog"), query: { category: cat } }}
              className={filterClass(activeCategory === cat)}
            >
              <MonoLabel size={11}>{b.categories[cat] || cat}</MonoLabel>
            </Link>
          ))}
        </div>

        <div className="mt-5">
          <MonoLabel size={11} className="text-muted">
            {filtered.length === 0
              ? activeCategory
                ? b.emptyCategory
                : b.emptyState
              : plural(b.countLabel, filtered.length, locale) +
                (activeLabel ? ` · ${activeLabel}` : "")}
          </MonoLabel>
        </div>

        {/* An empty category shows the count line and nothing else — no illustration,
            no consolation CTA. */}
        {filtered.length > 0 && (
          <div className="mt-2">
            {filtered.map((post) => (
              <BlogCard key={post.slug} post={post} dict={dict} locale={locale} />
            ))}
          </div>
        )}
      </SectionShell>
    </>
  );
}
