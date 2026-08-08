# Ankora Website

Next.js 14 (App Router) + TypeScript + Tailwind + Framer Motion. Bilingual (Hebrew default/RTL, English toggle) per the approved strategic plan.

## Run locally

```bash
npm install
npm run dev
```

Visit http://localhost:3000 — redirects to /he. Toggle language via the header control (routes to /en).

## Structure

- `app/[locale]/` — all routes, duplicated per locale via the dynamic segment (`/he/...`, `/en/...`)
- `content/he.ts`, `content/en.ts` — every string on the site, typed against `content/types.ts`. Edit copy here, never in components.
- `components/sections/` — homepage + page sections
- `components/layout/` — header (with solutions mega menu + language toggle) and footer
- `components/ui/`, `components/motion/` — shared primitives
- `middleware.ts` — redirects unprefixed paths to the default locale (`/` → `/he`)
- `tailwind.config.ts` — design tokens (navy/gold/paper palette, Heebo type)

## Notes

- Fonts are self-hosted via `@fontsource/heebo` rather than `next/font/google` — the build environment I worked in blocks Google Fonts' CDN, and self-hosting is more robust for production anyway (no runtime dependency on Google's servers).
- The contact form is UI-only (no backend wired up yet) — it needs an endpoint (email service, CRM webhook, etc.) before launch.
- `/privacy` and `/terms` are placeholders — legal copy still needs to be drafted.
- No services/pricing menu by design — see the strategic plan doc for why.

## Not yet built (flagged in the plan, out of v1 scope)

- `/insights` content hub (SEO keyword targets — reserved but empty)
- Real vendor/CRM integration behind the contact form
- Licensed typeface upgrade path (Heebo is the pragmatic default; see plan doc section 5)
