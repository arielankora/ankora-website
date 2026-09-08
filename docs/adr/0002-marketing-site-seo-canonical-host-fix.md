# ADR-0002: Marketing site — canonical host / indexing consistency fix

Status: Implemented, pending Ariel's review (PR open, not yet merged)
Date: 2026-09-08
Source: Google Search Console audit supplied directly by Ariel (not a spec document)
Scope: the public marketing site (`app/[locale]/**`, `app/sitemap.ts`, `app/robots.ts`,
`next.config.mjs`) only. Unrelated to the Time Tracking app covered by ADR-0001 — this
file exists separately so the two concerns don't get tangled in one document.

## 1. Problem

A GSC audit found three URL signals disagreeing about Ankora's canonical host:

1. Vercel's own domain configuration already 308-redirects the bare apex
   (`ankora.co.il`) to `www.ankora.co.il`, preserving the full path. This part was
   already correct and required no change.
2. Every page's `<link rel="canonical">` declared the **non-www** host
   (`https://ankora.co.il/...`).
3. `sitemap.xml`'s ~40 `<loc>` entries also used non-www.

Result: Google fetches a sitemap URL, gets redirected to `www`, then reads a canonical
pointing back at the non-www URL it was just redirected away from — a self-contradicting
signal. GSC reported this as "Page with redirect" (16 URLs, 14 of them sitemap-supplied).

Two more, unrelated-looking issues traced back to the same missing-metadata root cause
(see §2): `/he/coverage` canonicalizing to the Hebrew homepage, and `/en/privacy`
canonicalizing to the English homepage with a non-unique title (both flagged by GSC;
`/en/privacy` had at one point been given away to `marcustheatres.com` as Google's
best-guess canonical, which is what happens when a page truly has no self-identifying
signal of its own).

## 2. Root cause

Two independent bugs, both structural rather than per-page:

**a) Wrong host, one line, blast radius = whole site.** `app/[locale]/layout.tsx` set
`metadataBase: new URL("https://ankora.co.il")` (no www). Every page whose
`generateMetadata` returns a *relative* `alternates.canonical` (e.g. `/he/about`) has it
resolved against `metadataBase` — so every one of those pages, plus every hardcoded
`const base = "https://ankora.co.il"` used for JSON-LD `url` fields (home, about,
personal-operations-management, blog index, blog posts, Breadcrumbs schema), inherited
the wrong host. `sitemap.ts` and `robots.ts` had their own independent copies of the same
non-www string.

**b) Twelve pages had no page-level metadata at all.** In Next.js App Router, a page that
doesn't export `generateMetadata` inherits the parent layout's metadata object as-is —
including `alternates.canonical: "/${locale}"`, i.e. the homepage. `coverage`, `privacy`,
`pricing`, `roi`, `contact`, `terms`, `how-it-works`, `technology`, and the `solutions`
index/`executives`/`founders`/`family-office` pages all had this gap; coverage and privacy
are simply the two GSC happened to flag by name. Six of these
(`coverage`, `how-it-works`, `pricing`, `roi`, `solutions` index, `technology`) are client
components (`"use client"`), which cannot export `generateMetadata` — a server-only export
— so fixing them required more than adding a function.

A third, smaller bug shared the same "assumed a fixed relationship that doesn't hold"
shape: the site-wide `LanguageToggle` swapped only the locale segment of the current path
(`/he/blog/esta` → `/en/blog/esta`) assuming identical slugs across locales. Blog slugs
are chosen independently per language (`lib/blog-shared.ts`'s `slugify()` — Hebrew titles
get transliterated/hashed, not translated) and none of the site's 4 published posts
actually share a slug across locales. This produced a real, crawlable 404 from the Hebrew
ESTA article, which GSC caught.

## 3. Fix

**Single source of truth for the host.** New `lib/site.ts`:
```ts
export const SITE_URL = "https://www.ankora.co.il";
```
`metadataBase` in `app/[locale]/layout.tsx`, every `const base = "..."` (5 page files +
`Breadcrumbs.tsx`), `app/sitemap.ts`, and `app/robots.ts`'s `sitemap:` pointer now import
this constant instead of repeating the literal. One line changes the whole site's host
going forward; nothing here should ever need editing in more than one place again.

**Every page self-canonicalizes.** The 6 already-correct pages (home, about,
personal-operations-management, ankora-vs-personal-assistant,
personal-assistant-for-executives, blog index, blog posts) needed no change beyond the
`metadataBase` fix, since their `alternates.canonical` was already relative and correctly
path-specific. For the 12 broken pages:
- 6 server components (`privacy`, `contact`, `terms`, `solutions/executives`,
  `solutions/founders`, `solutions/family-office`) got a `generateMetadata` added directly,
  returning only `alternates` (canonical + hreflang `languages`) — title/description are
  deliberately left unset so they keep inheriting from the layout, since fixing the
  canonical is what was asked for, not rewriting page copy. `privacy` is the one exception:
  it also now returns a unique title, `${legal.privacyTitle} | Ankora"` — built from the
  existing `legal.privacyTitle` string ("Privacy Policy" / "מדיניות פרטיות"), not new copy.
- 6 client components (`coverage`, `how-it-works`, `pricing`, `roi`, `solutions` index,
  `technology`) were split: the original file's content moved verbatim into a co-located
  `*Client.tsx` (same "use client" directive, same logic, same JSX — only the function name
  changed, from e.g. `CoveragePage` to `CoverageClient`), and `page.tsx` became a thin
  server component that exports `generateMetadata` and renders the client component. Zero
  visual or behavioral change; this is purely making each route directory own its own
  metadata the same way the other 6 already did.

**Blog language toggle.** New `lib/blog-translations.ts` — a small curated
`{ "he/slug": "en-slug" }` map — plus `LanguageToggle.tsx` now checks whether the current
path is a blog article and, if so, looks up the real translated slug instead of assuming
one. A post absent from the map (i.e. no known translation) falls back to the other
locale's blog index, which is always a valid page — so this class of bug cannot reproduce
for any future post, translated or not.

**Redirects.** `next.config.mjs` gained a `redirects()` array with exactly three entries —
the historical `/solutions/companies` and `/solutions/executives` (pre-dating
locale-prefixed routing; the current pages live at `/he|en/solutions/*`, defaulted to `he`
to match the site's existing `/` → `/he` default) and `/en/blog/esta` (the broken language-
toggle target, now pointing straight at the real article). All three use an explicit
`statusCode: 301` (Next's `permanent: true` alone produces 308, which is what Vercel's own
apex→www redirect already correctly uses — 301 was requested explicitly for these three).
Vercel's apex→www redirect is deliberately *not* duplicated in `next.config.mjs`, to avoid
turning one hop into two.

## 4. What was deliberately left unchanged

- No visible page copy, headings, or marketing content changed anywhere.
- No slugs changed.
- No pages removed or added.
- No structured data fields changed beyond the host string inside existing `url`/`@id`
  values (same shape, correct host).
- `blog/[slug]/page.tsx`'s `alternates` intentionally has no `languages` entry — blog post
  slugs don't reliably have a same-locale-shaped counterpart, so declaring an hreflang
  alternate there would risk pointing at content that doesn't correspond 1:1. This was true
  before this change and is unrelated to it.

## 5. Verification

See the PR description and the chat report for the full crawl output (every sitemap URL's
status/canonical/redirect, plus the explicit acceptance-test URLs from the request). Local
`next build`'s compile step succeeded; the only failures come from `prisma generate`/`tsc`
being unable to reach `binaries.prisma.sh` from this sandbox (a pre-existing, unrelated
limitation affecting the product-app's Prisma-typed files — see ADR-0001 — not anything
touched here). Live verification ran against the Vercel Preview deployment, not local
inspection alone.

**Status:** implemented and Preview-verified. PR open from
`fix/seo-www-canonical-consistency`, awaiting Ariel's review before merge, per the standing
"never merge without approval" rule.

## 6. Addendum: one page missed in the first pass

The initial `generateMetadata` sweep (section 3) covered 12 pages that lacked page-level
metadata, but missed a 13th: `app/[locale]/solutions/companies/page.tsx`. It is a server
component with no client-split need, so it was easy to overlook next to its three siblings
(`executives`, `founders`, `family-office`) which all received `generateMetadata` in the
first commit. This was caught by the Phase 10 full-sitemap crawl against the deployed
Preview (not local inspection) — `/he/solutions/companies` and `/en/solutions/companies`
were declaring the homepage as canonical, the exact bug class this fix exists to eliminate.

Fixed in a follow-up commit with the identical pattern used for its siblings (self-
referencing canonical + hreflang alternates, no content/title override). Re-crawled the
full 42-URL sitemap against the redeployed Preview afterward — 0 canonical mismatches.
