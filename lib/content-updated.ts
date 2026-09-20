import { execFileSync } from "node:child_process";

/**
 * When a page's content last changed, taken from git rather than written down.
 *
 * The date was authored in the dictionary as "August 2026", which is true until the
 * next edit and then quietly false — exactly the thing the handoff's own key note rules
 * out for reading time, for the same reason.
 *
 * Deliberately NOT used on the legal pages. There "last updated" is a statement about
 * the document, and a date that moves because somebody fixed a typo tells a reader the
 * policy changed when it did not. Those stay authored, and the content file says so.
 *
 * Resolved at build time. A deployment from a shallow clone or a tarball has no git
 * history, so the fallback is the authored string the dictionary still carries.
 */
const cache = new Map<string, string | null>();

export function lastContentChange(paths: string[]): string | null {
  const key = paths.join("|");
  if (cache.has(key)) return cache.get(key) ?? null;

  let iso: string | null = null;
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", ...paths], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // %cs is YYYY-MM-DD; the pages render year and month only.
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) iso = out.slice(0, 7);
  } catch {
    iso = null;
  }
  cache.set(key, iso);
  return iso;
}

/** "2026-09" -> "ספטמבר 2026" / "September 2026", through the locale formatter. */
export function formatMonth(iso: string, locale: "he" | "en"): string {
  const [year, month] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", {
    year: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * What the three long-form pages render. Derived where git can tell us, falling back to
 * the authored pair the dictionary still carries.
 *
 * Server-only: it shells out to git, so it runs at build time in a server component.
 */
export function contentUpdated(
  locale: "he" | "en",
  seo: { updated: string; updatedISO: string }
): { iso: string; label: string } {
  const iso = lastContentChange(["content/he.ts", "content/en.ts"]);
  if (!iso) return { iso: seo.updatedISO, label: seo.updated };

  // Both locales write the string as "<prefix>: <month year>", so the month is swapped
  // inside the authored sentence rather than the sentence being rebuilt here -- the
  // prefix stays copy, reviewed in the dictionary, and only the date is computed.
  const month = formatMonth(iso, locale);
  const sep = seo.updated.indexOf(":");
  const label = sep === -1 ? month : `${seo.updated.slice(0, sep + 1)} ${month}`;
  return { iso, label };
}
