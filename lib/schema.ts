import "server-only";
import { execFileSync } from "node:child_process";
import { SITE_URL } from "@/lib/site";
import { COMPANY_PROFILES, FOUNDERS } from "@/lib/founders";

/**
 * Structured data that describes Ankora as ONE entity across the whole site.
 *
 * Before this, every page built its own `{"@type":"Organization","name":"Ankora"}`,
 * so search engines and AI models saw a dozen unlinked organisations with
 * different descriptions and no way to tell they were the same company (SEO/GEO
 * audit, 1.10.2026). Now the layout publishes the Organization and the WebSite
 * once, each with a stable @id, and every page points at them by @id.
 *
 * Profiles and people live in lib/founders.ts:
 * - COMPANY_PROFILES -> sameAs. Entity recognition works by matching the same
 *   entity across sources; without these there is nothing to match.
 * - FOUNDERS -> founder, each a Person with their own profile as sameAs.
 */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;


const SAME_AS: string[] = COMPANY_PROFILES;

export function founderNode(f: (typeof FOUNDERS)[number], locale: "he" | "en") {
  const other = locale === "he" ? "en" : "he";
  return {
    "@type": "Person",
    "@id": `${SITE_URL}/#person-${f.linkedin.split("/in/")[1].replace(/\/$/, "")}`,
    name: f.name[locale],
    alternateName: f.name[other],
    jobTitle: f.role[locale],
    description: f.bio[locale],
    image: `${SITE_URL}${f.image}`,
    sameAs: [f.linkedin],
    worksFor: { "@id": ORG_ID },
  };
}

type Locale = "he" | "en";

const ORG_DESCRIPTION: Record<Locale, string> = {
  he: "אנקורה היא חברה ישראלית לניהול תפעול אישי: מנהל תפעול אנושי ייעודי, בגיבוי תזמור AI, שלוקח אחריות מלאה על התפעול האישי, הביתי והעסקי של מנהלים, יזמים ומשפחות עסוקות.",
  en: "Ankora is an Israeli Personal Operations Management company: a dedicated human Operations Manager, backed by AI orchestration, who takes end-to-end ownership of the personal, household and business operations of executives, founders and busy families.",
};

export function organizationNode(locale: Locale) {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Ankora",
    alternateName: "אנקורה",
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/site-icon-512.png`, width: 512, height: 512 },
    image: `${SITE_URL}/logo.png`,
    description: ORG_DESCRIPTION[locale],
    email: "hello@ankora.co.il",
    address: { "@type": "PostalAddress", addressLocality: "Tel Aviv", addressCountry: "IL" },
    areaServed: { "@type": "Country", name: "Israel" },
    knowsAbout: [
      "Personal Operations Management",
      "Operational Intelligence",
      "Executive operations",
      "Vendor management",
      "Travel management",
      "AI orchestration",
    ],
    contactPoint: {
      "@type": "ContactPoint",
      email: "hello@ankora.co.il",
      contactType: "customer service",
      areaServed: "IL",
      availableLanguage: ["he", "en"],
    },
    ...(SAME_AS.length ? { sameAs: SAME_AS } : {}),
    ...(FOUNDERS.length ? { founder: FOUNDERS.map((f) => founderNode(f, locale)) } : {}),
  };
}

export function websiteNode(locale: Locale) {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: "Ankora",
    alternateName: "אנקורה",
    inLanguage: locale,
    publisher: { "@id": ORG_ID },
  };
}

/** The site-wide graph the layout renders on every page. */
export function siteGraph(locale: Locale) {
  return { "@context": "https://schema.org", "@graph": [organizationNode(locale), websiteNode(locale)] };
}

/** Reference to the one Organization, for `provider`, `publisher`, `author`. */
export const orgRef = { "@id": ORG_ID } as const;

/**
 * Full date (YYYY-MM-DD) of the last commit that touched any of `paths`, read
 * from git at build time. Used for dateModified, so it moves only when the
 * content actually changes, never on a deploy. Null without git history.
 */
const cache = new Map<string, string | null>();
export function lastCommitDate(paths: string[]): string | null {
  const key = paths.join("|");
  if (cache.has(key)) return cache.get(key) ?? null;
  let date: string | null = null;
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", ...paths], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) date = out;
  } catch {
    date = null;
  }
  cache.set(key, date);
  return date;
}

/**
 * Article node for the long-form pages (the category page and the comparisons).
 * datePublished is authored: it is the day the page first went live (from git,
 * written down so a shallow clone cannot move it). dateModified follows the
 * content files, with the authored ISO month as the fallback.
 */
export function articleNode(opts: {
  locale: Locale;
  path: string;
  headline: string;
  description: string;
  datePublished: string;
  modifiedFallback: string;
  contentPaths?: string[];
}) {
  const url = `${SITE_URL}/${opts.locale}${opts.path}`;
  const modified =
    lastCommitDate(opts.contentPaths ?? ["content/he.ts", "content/en.ts"]) ?? opts.modifiedFallback;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    headline: opts.headline,
    description: opts.description,
    url,
    mainEntityOfPage: url,
    inLanguage: opts.locale,
    datePublished: opts.datePublished,
    dateModified: modified < opts.datePublished ? opts.datePublished : modified,
    author: orgRef,
    publisher: orgRef,
    isPartOf: { "@id": WEBSITE_ID },
    image: `${SITE_URL}/${opts.locale}/opengraph-image`,
  };
}

/**
 * A blog author: the founder's Person node when the author is a founder (by
 * either spelling of the name), otherwise a plain Person who works for Ankora.
 */
export function authorNode(name: string, locale: Locale) {
  const f = FOUNDERS.find((x) => x.name.he === name || x.name.en === name);
  if (f) return founderNode(f, locale);
  return { "@type": "Person", name, worksFor: orgRef };
}
