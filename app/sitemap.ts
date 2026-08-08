import type { MetadataRoute } from "next";

const routes = ["", "/how-it-works", "/technology", "/about", "/contact", "/solutions", "/solutions/executives", "/solutions/founders", "/solutions/companies", "/solutions/family-office"];
const base = "https://ankora.co.il";

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  for (const locale of ["he", "en"]) {
    for (const route of routes) {
      entries.push({
        url: `${base}/${locale}${route}`,
        lastModified: new Date(),
        changeFrequency: "monthly",
        priority: route === "" ? 1 : 0.7,
      });
    }
  }
  return entries;
}
