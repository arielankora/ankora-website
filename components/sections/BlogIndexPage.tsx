"use client";

import Link from "next/link";
import type { Dictionary, Locale } from "@/content";
import type { BlogPostMeta } from "@/lib/blog-shared";
import { BLOG_CATEGORY_SLUGS } from "@/lib/blog-shared";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { BlogCard } from "@/components/sections/BlogCard";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

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

  return (
    <>
      <PageHero
        eyebrow={b.eyebrow}
        title={b.title}
        sub={b.sub}
        breadcrumb={<Breadcrumbs locale={locale} items={[{ label: b.eyebrow }]} />}
      />

      <section className="bg-paper py-16 md:py-24">
        <Container>
          <div className="flex flex-wrap gap-2">
            <Link
              href={withLocale(locale, "/blog")}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm transition-colors",
                !activeCategory
                  ? "border-gold bg-gold/10 text-navy"
                  : "border-lineDark text-navy/55 hover:border-gold/50"
              )}
            >
              {b.allCategories}
            </Link>
            {BLOG_CATEGORY_SLUGS.map((cat) => (
              <Link
                key={cat}
                href={{ pathname: withLocale(locale, "/blog"), query: { category: cat } }}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm transition-colors",
                  activeCategory === cat
                    ? "border-gold bg-gold/10 text-navy"
                    : "border-lineDark text-navy/55 hover:border-gold/50"
                )}
              >
                {b.categories[cat] || cat}
              </Link>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Reveal className="mt-16 rounded-2xl border border-dashed border-lineDark px-8 py-20 text-center">
              <p className="text-navy/50">{b.emptyState}</p>
            </Reveal>
          ) : (
            <RevealStagger className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((post) => (
                <motion.div key={`${post.locale}-${post.slug}`} variants={staggerItem}>
                  <BlogCard post={post} dict={dict} locale={locale} />
                </motion.div>
              ))}
            </RevealStagger>
          )}
        </Container>
      </section>
    </>
  );
}
