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
} from "@/lib/blog-shared";

export { BLOG_CATEGORY_SLUGS, COVER_IMAGE_POSITIONS, coverPositionClass, slugify } from "@/lib/blog-shared";
export type { BlogCategorySlug, BlogPostMeta, BlogPost, CoverImagePosition } from "@/lib/blog-shared";

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

export function serializePost(
  data: Omit<BlogPostMeta, "readingMinutes" | "slug" | "locale">,
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
  });
}
