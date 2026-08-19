import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";

// Priority reflects position in the information architecture, not ranking intent.
const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, changeFrequency: "weekly" },
  { path: "/personal-operations-management", priority: 0.9, changeFrequency: "monthly" },
  { path: "/ankora-vs-personal-assistant", priority: 0.9, changeFrequency: "monthly" },
  { path: "/personal-assistant-for-executives", priority: 0.85, changeFrequency: "monthly" },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" },
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
];

const base = "https://ankora.co.il";

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
  }
  return entries;
}
