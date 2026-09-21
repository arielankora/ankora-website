import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { getAllStories } from "@/lib/customer-stories";
import { SITE_URL } from "@/lib/site";

// Priority reflects position in the information architecture, not ranking intent.
const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, changeFrequency: "weekly" },
  { path: "/personal-operations-management", priority: 0.9, changeFrequency: "monthly" },
  { path: "/ankora-vs-personal-assistant", priority: 0.9, changeFrequency: "monthly" },
  { path: "/personal-assistant-for-executives", priority: 0.85, changeFrequency: "monthly" },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" },
  // The evidence hub: it answers "does this work for people like me", which is the
  // question immediately after the category page, and it is where the corpus grows.
  { path: "/customer-stories", priority: 0.8, changeFrequency: "monthly" },
  { path: "/technology", priority: 0.7, changeFrequency: "monthly" },
  { path: "/about", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" },
  { path: "/roi", priority: 0.7, changeFrequency: "monthly" },
  { path: "/coverage", priority: 0.7, changeFrequency: "monthly" },
  { path: "/blog", priority: 0.7, changeFrequency: "weekly" },
  { path: "/contact", priority: 0.6, changeFrequency: "yearly" },
  { path: "/solutions", priority: 0.75, changeFrequency: "monthly" },
  { path: "/solutions/executives", priority: 0.7, changeFrequency: "monthly" },
  { path: "/solutions/founders", priority: 0.7, changeFrequency: "monthly" },
  { path: "/solutions/companies", priority: 0.7, changeFrequency: "monthly" },
  { path: "/solutions/family-office", priority: 0.7, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/service-terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/security", priority: 0.5, changeFrequency: "monthly" },
  { path: "/dpa", priority: 0.3, changeFrequency: "yearly" },
];

const base = SITE_URL;

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  for (const locale of ["he", "en"] as const) {
    for (const route of routes) {
      entries.push({
        url: `${base}/${locale}${route.path}`,
        lastModified: new Date(),
        changeFrequency: route.changeFrequency,
        priority: route.priority,
      });
    }
    for (const post of getAllPosts(locale)) {
      entries.push({
        url: `${base}/${locale}/blog/${post.slug}`,
        lastModified: new Date(post.updatedAt || post.publishedAt),
        changeFrequency: "monthly",
        priority: 0.65,
      });
    }
    // Draft stories are filtered out by getAllStories, so an unapproved story is never
    // submitted for indexing.
    for (const story of getAllStories(locale)) {
      entries.push({
        url: `${base}/${locale}/customer-stories/${story.slug}`,
        lastModified: new Date(story.updatedDate || story.publishedDate),
        changeFrequency: "yearly",
        priority: 0.7,
      });
    }
  }
  return entries;
}
