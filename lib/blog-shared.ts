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

// Cover images are cropped to fit two different landscape-oriented boxes (the
// blog card thumbnail and the article hero) - a portrait or square photo
// will lose its top and/or bottom. This lets the editor choose which part
// of the source image stays visible in the crop, instead of always cropping
// dead-center.
export const COVER_IMAGE_POSITIONS = ["top", "center", "bottom"] as const;
export type CoverImagePosition = (typeof COVER_IMAGE_POSITIONS)[number];

export function coverPositionClass(pos?: string | null): string {
  return pos === "top" ? "object-top" : pos === "bottom" ? "object-bottom" : "object-center";
}

export interface BlogPostMeta {
  slug: string;
  locale: Locale;
  title: string;
  excerpt: string;
  category: BlogCategorySlug;
  tags: string[];
  coverImage: string | null;
  coverImagePosition: CoverImagePosition;
  author: string;
  publishedAt: string;
  updatedAt: string | null;
  draft: boolean;
  /** Slug of the same post in the other language, when there is one. */
  translationOf: string | null;
  /** Rendered under the post and published as FAQPage. */
  faq: BlogFaqItem[];
  readingMinutes: number;
}

export type BlogFaqItem = { q: string; a: string };

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A slug the routes would accept, or null. */
export function cleanTranslationOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 && v.length <= 120 && SAFE_SLUG.test(v) ? v : null;
}

// Answer engines quote FAQ answers whole, so they stay short. The limits are
// generous for a person and stop a runaway agent from writing an essay.
export const FAQ_MAX_ITEMS = 8;
const FAQ_MAX_Q = 200;
const FAQ_MAX_A = 1200;

/** Only complete question/answer pairs survive; nothing is truncated silently. */
export function cleanFaq(value: unknown): BlogFaqItem[] {
  if (!Array.isArray(value)) return [];
  const out: BlogFaqItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const q = typeof (item as any).q === "string" ? (item as any).q.trim() : "";
    const a = typeof (item as any).a === "string" ? (item as any).a.trim() : "";
    if (!q || !a || q.length > FAQ_MAX_Q || a.length > FAQ_MAX_A) continue;
    out.push({ q, a });
    if (out.length === FAQ_MAX_ITEMS) break;
  }
  return out;
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
