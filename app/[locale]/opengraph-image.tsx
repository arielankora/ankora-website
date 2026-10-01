import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { locales } from "@/content";

// The share image for every page under a locale that does not set its own
// (blog posts and customer stories do). Before this, 48 of 54 pages had no
// og:image, so a link shared on LinkedIn or WhatsApp arrived as bare text
// (SEO/GEO audit, 1.10.2026).
//
// The images are rendered once from the brand typography (Heebo, gold on navy)
// and committed as public/og-he.png and public/og-en.png; this route serves the
// right one per locale. Regenerate them if the hero line changes.
export const alt = "Ankora";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const file = locale === "en" ? "og-en.png" : "og-he.png";
  const png = await readFile(join(process.cwd(), "public", file));
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
