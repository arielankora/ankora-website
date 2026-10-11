import "server-only";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";
import type { Locale } from "@/content";
import {
  BLOG_CATEGORY_SLUGS,
  COVER_IMAGE_POSITIONS,
  type BlogPostMeta,
  type BlogPost,
  type CoverImagePosition,
  cleanFaq,
  cleanTranslationOf,
} from "@/lib/blog-shared";

export { BLOG_CATEGORY_SLUGS, COVER_IMAGE_POSITIONS, coverPositionClass, slugify } from "@/lib/blog-shared";
export type { BlogCategorySlug, BlogPostMeta, BlogPost, CoverImagePosition, BlogFaqItem } from "@/lib/blog-shared";
export { cleanFaq, cleanTranslationOf } from "@/lib/blog-shared";

function blogDir(locale: Locale) {
  return path.join(process.cwd(), "content", "blog", locale);
}

function readFile(locale: Locale, slug: string): { data: Record<string, any>; content: string } | null {
  const file = path.join(blogDir(locale), `${slug}.mdx`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  return matter(raw);
}

function toMeta(locale: Locale, slug: string, data: Record<string, any>, content: string): BlogPostMeta {
  return {
    slug,
    locale,
    title: data.title || slug,
    excerpt: data.excerpt || "",
    category: (BLOG_CATEGORY_SLUGS as readonly string[]).includes(data.category)
      ? data.category
      : "company-insights",
    tags: Array.isArray(data.tags) ? data.tags : [],
    coverImage: data.coverImage || null,
    coverImagePosition: (COVER_IMAGE_POSITIONS as readonly string[]).includes(data.coverImagePosition)
      ? data.coverImagePosition
      : "center",
    author: data.author || "Ankora",
    publishedAt: data.publishedAt || new Date().toISOString().slice(0, 10),
    updatedAt: data.updatedAt || null,
    draft: !!data.draft,
    translationOf: cleanTranslationOf(data.translationOf),
    faq: cleanFaq(data.faq),
    readingMinutes: Math.max(1, Math.round(readingTime(content || "").minutes)),
  };
}

export function getAllPostSlugs(locale: Locale, { includeDrafts = false } = {}): string[] {
  const dir = blogDir(locale);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""))
    .filter((slug) => {
      if (includeDrafts) return true;
      const parsed = readFile(locale, slug);
      return parsed ? !parsed.data.draft : false;
    });
}

export function getPostBySlug(locale: Locale, slug: string): BlogPost | null {
  const parsed = readFile(locale, slug);
  if (!parsed) return null;
  return { ...toMeta(locale, slug, parsed.data, parsed.content), content: parsed.content };
}

export function getAllPosts(locale: Locale, { includeDrafts = false } = {}): BlogPostMeta[] {
  const dir = blogDir(locale);
  if (!fs.existsSync(dir)) return [];
  const posts = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => {
      const slug = f.replace(/\.mdx$/, "");
      const parsed = readFile(locale, slug)!;
      return toMeta(locale, slug, parsed.data, parsed.content);
    })
    .filter((p) => includeDrafts || !p.draft)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  return posts;
}

export function getPostsByCategory(locale: Locale, category: string, { includeDrafts = false } = {}): BlogPostMeta[] {
  return getAllPosts(locale, { includeDrafts }).filter((p) => p.category === category);
}

export function getRelatedPosts(locale: Locale, current: BlogPostMeta, limit = 3): BlogPostMeta[] {
  const all = getAllPosts(locale).filter((p) => p.slug !== current.slug);
  const sameCategory = all.filter((p) => p.category === current.category);
  const rest = all.filter((p) => p.category !== current.category);
  return [...sameCategory, ...rest].slice(0, limit);
}

export function postFilePath(locale: Locale, slug: string) {
  return `content/blog/${locale}/${slug}.mdx`;
}

// Every field a post can carry is written here. A field missing from this
// list is deleted the next time the post is saved from the admin, which is
// why translationOf and faq are written even though the editor has no
// inputs for them yet.
export function serializePost(
  data: Omit<BlogPostMeta, "readingMinutes" | "slug" | "locale" | "translationOf" | "faq"> & {
    translationOf?: string | null;
    faq?: BlogPostMeta["faq"];
  },
  content: string
) {
  return matter.stringify(content, {
    title: data.title,
    excerpt: data.excerpt,
    category: data.category,
    tags: data.tags,
    coverImage: data.coverImage,
    coverImagePosition: data.coverImagePosition,
    author: data.author,
    publishedAt: data.publishedAt,
    updatedAt: data.updatedAt,
    draft: data.draft,
    // Written only when set, so posts without them stay as they were.
    ...(data.translationOf ? { translationOf: data.translationOf } : {}),
    ...(data.faq && data.faq.length ? { faq: data.faq } : {}),
  });
}

/**
 * Published post pairs across the two languages, keyed "locale/slug" and
 * valued with the other language's slug. A post names its counterpart in
 * `translationOf`; one side is enough, the pair is read in both directions.
 * A pair counts only when both posts exist and are published, so hreflang
 * and the language toggle never point at a draft or a 404.
 */
export function getBlogTranslationPairs(): Record<string, string> {
  const live: Record<Locale, Map<string, BlogPostMeta>> = {
    he: new Map(getAllPosts("he").map((p) => [p.slug, p])),
    en: new Map(getAllPosts("en").map((p) => [p.slug, p])),
  };
  const pairs: Record<string, string> = {};
  for (const locale of ["he", "en"] as const) {
    const other = locale === "he" ? "en" : "he";
    for (const post of live[locale].values()) {
      if (!post.translationOf || !live[other].has(post.translationOf)) continue;
      // If two posts claim the same counterpart, the first one read keeps it.
      if (pairs[`${locale}/${post.slug}`] || pairs[`${other}/${post.translationOf}`]) continue;
      pairs[`${locale}/${post.slug}`] = post.translationOf;
      pairs[`${other}/${post.translationOf}`] = post.slug;
    }
  }
  return pairs;
}
