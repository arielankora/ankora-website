// Types and pure helpers safe to import from client components.
// Anything that touches the filesystem lives in lib/blog.ts (server-only).
import type { Locale } from "@/content";

export const BLOG_CATEGORY_SLUGS = [
  "personal-operations",
  "household-property",
  "vendors-services",
  "travel-logistics",
  "business-operations",
  "company-insights",
] as const;

export type BlogCategorySlug = (typeof BLOG_CATEGORY_SLUGS)[number];

export interface BlogPostMeta {
  slug: string;
  locale: Locale;
  title: string;
  excerpt: string;
  category: BlogCategorySlug;
  tags: string[];
  coverImage: string | null;
  author: string;
  publishedAt: string;
  updatedAt: string | null;
  draft: boolean;
  readingMinutes: number;
}

export interface BlogPost extends BlogPostMeta {
  content: string;
}

// Slugs are always ASCII (Latin letters, numbers, hyphens) regardless of the
// post's language. Non-Latin URL segments (e.g. Hebrew) trigger inconsistent
// routing behavior on Vercel/Next.js for statically generated dynamic routes
// (works sometimes, 404s or crashes other times) - confirmed by hands-on
// testing. Titles stay fully Hebrew/English as written; only the URL slug is
// restricted.
export function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (base) return base;
  // Title had no Latin/number characters (e.g. a pure-Hebrew title) - fall
  // back to a short, unique, ASCII-safe slug.
  return `post-${Date.now().toString(36)}`;
}
