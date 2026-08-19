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

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u0590-\u05FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
