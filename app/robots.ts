import type { MetadataRoute } from "next";

// Ankora's site is entirely public marketing content, there are no account
// areas or private sections to gate. Every legitimate crawler, including AI
// answer-engine crawlers, is allowed across the whole site except the
// non-content /api/ routes. Listed explicitly (rather than relying only on
// the "*" wildcard) so the intent is documented and each entry can be
// tightened independently later if needed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "Googlebot", allow: "/", disallow: ["/api/", "/admin/"] },
      { userAgent: "Bingbot", allow: "/", disallow: ["/api/", "/admin/"] },
      { userAgent: "OAI-SearchBot", allow: "/", disallow: ["/api/", "/admin/"] },
      { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/"] },
    ],
    sitemap: "https://ankora.co.il/sitemap.xml",
  };
}
