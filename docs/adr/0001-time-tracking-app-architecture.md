# ADR-0001: Time Tracking App — Architecture Decision Record

Status: Proposed (pending DB provider confirmation)
Date: 2026-09-04
Source spec: `Ankora_Time_Tracking_Product_Spec_HE.docx` (v1.0, September 2026)

## 1. Existing stack (audit)

- **Framework**: Next.js 14.2 (App Router), React 18, TypeScript 5.5. No Pages Router.
- **Styling**: Tailwind CSS 3.4, single `tailwind.config.ts`, no component library (shadcn/ui not installed).
- **Content**: Fully static/git-backed. Marketing copy lives in `content/he.ts` / `content/en.ts` dictionaries; blog posts are MDX files with YAML frontmatter under `content/blog/{locale}/{slug}.mdx`, compiled at request time via `next-mdx-remote/rsc`.
- **Data layer**: **None.** No database, no ORM, nothing beyond the filesystem read via `fs` in `lib/blog.ts`.
- **Auth**: One purpose-built mechanism for the blog admin only — a single shared password (`ADMIN_PASSWORD` env var) plus an HMAC-SHA256-signed, expiring session cookie (`lib/adminAuth.ts`). No user records, no roles, no per-user identity anywhere in the app.
- **"Publishing" mechanism**: The blog admin writes files directly to GitHub via the Contents API (`lib/github.ts`), which triggers Vercel's normal git-based deploy. There is no runtime database write path anywhere in the codebase today.
- **Hosting**: Vercel project `ankora-website`, GitHub-connected (`arielankora/ankora-website`), auto-deploys `main` → Production (`ankora.co.il`) and every branch → its own Preview URL. Env vars are managed per-environment (Production/Preview) in the Vercel dashboard; System Environment Variables are enabled.
- **Routing**: Everything lives under `app/[locale]/**` (`he` | `en`), including the existing admin panel (`app/[locale]/admin/**`). `vercel.json` only redirects `/` → `/he`.
- **i18n**: Custom, not a library — two dictionary files keyed by `Locale = "he" | "en"`, `dir="rtl"` for Hebrew throughout.
- **No middleware.ts** exists yet.

**Conclusion**: this is a static marketing site with zero backend/data infrastructure. The time tracking app is a genuinely new subsystem, not an extension of existing patterns beyond styling and hosting.

## 2. Integration under the Ankora domain

Per spec §3.1/§3.2 (prefer subpath on the existing stack if it's already React/Next.js — it is): the app will live in the **same Next.js project and repo**, mounted at **`https://ankora.co.il/app`**, as a new top-level route group **outside** the `[locale]` segment (`app/(product)/app/**`) — this is an internal/client tool, not a marketing page, so it does not go through the marketing i18n dictionaries. Hebrew RTL is the only UI language for MVP (spec §2.2, §19 — plan for i18n later, don't build it now).

Rationale for subpath over `app.ankora.co.il`: no technical constraint forces a subdomain (the site is already Next.js, not WordPress), a subpath shares the session/cookie domain automatically (simpler, more secure auth than cross-subdomain cookies), ships in the same deploy (no second Vercel project, no new DNS record), and matches the spec's own stated preference.

A new `middleware.ts` will gate every `/app/**` request on a valid session before the page even renders (defense in depth on top of per-endpoint server-side authorization, per spec §4.1).

## 3. Design tokens (reuse, no new brand)

From `tailwind.config.ts`, to be reused as-is — no new palette, no new font:

| Token | Value | Use |
|---|---|---|
| `ink` | `#0B1B33` | darkest surfaces |
| `navy` | `#1B2A3D` | primary text / dark surfaces |
| `cream` | `#F3EADB` | warm surface |
| `paper` / `paperDim` | `#F8F4EC` / `#EDE3D2` | light backgrounds |
| `gold` (`DEFAULT`/`light`/`dim`) | `#B08D57` / `#C7AC7E` / `#8A6F45` | accents, primary actions |
| `line` / `lineDark` / `lineGold` | translucent navy/gold | borders |
| font | Heebo (`@fontsource/heebo`) | all text |
| `maxWidth.content` | 1440px | outer page shell |
| `gold-gradient`, `radial-glow` | existing gradients | CTA buttons, hero glows |

The app will reuse existing primitives (`components/ui/Container.tsx`, `Button.tsx`, `Badge.tsx`) rather than inventing new ones, and follow spec §19's guidance: calm accents, red only for errors/overage, green only for success, no "gamified" timer, minimalist charts.

## 4. New infrastructure required (not currently in the repo)

| Concern | Decision |
|---|---|
| Database | **PostgreSQL** (spec §3.2 explicit requirement — no LocalStorage as source of truth) |
| DB provider | **Open — needs your decision, see chat.** Leading option: Vercel Postgres (same dashboard/env-var flow already used for the blog). |
| ORM/migrations | **Prisma** — mature migration tooling, TypeScript types generated from schema, easiest to review migrations as plain SQL diffs (spec explicitly requires migration review at the end of every phase). |
| Auth | **Auth.js (next-auth) v5, Credentials provider + bcrypt password hashing + Prisma adapter.** Not a paid SaaS auth vendor (Clerk/Auth0) — no new cost, no new third party holding Ankora's user data, but a well-audited library rather than hand-rolled crypto for something this security-sensitive (multi-tenant client isolation, session security, rate limiting are all explicit spec requirements in §16.2). |
| Rate limiting | In-memory/DB-backed sliding window on the login endpoint for MVP (no Redis dependency yet; documented as a known limitation if traffic ever requires a shared store across serverless instances). |
| Testing | Vitest for unit/integration tests (fast, TS-native, no config baggage); Playwright for the E2E scenarios in spec §21.3, run against a seeded test database. |

## 5. Phased plan (spec §23), mapped to this engagement

| Phase | Spec scope | This session |
|---|---|---|
| **Phase 0** | Repo/hosting/design audit; ADR; DB schema; environments | **This document** + Prisma schema modeling spec §5 + folder scaffolding + `.env.example` + README additions. In progress now. |
| **Phase 1** | Auth, roles, users, clients, categories | Next, after Phase 0 acceptance criteria pass. |
| Phase 2 | Timer + TimeEntry + manual entry + audit revisions | Not in this engagement — future session. |
| Phase 3 | Billing policy + hour bank + live client snapshot | Not in this engagement. |
| Phase 4 | Alerts + email delivery logs | Not in this engagement. |
| Phase 5 | Internal dashboards + reports + exports | Not in this engagement. |
| Phase 6 | Client portal + scheduled reports | Not in this engagement. |
| Phase 7 | PWA/mobile polish + performance + security hardening | Not in this engagement. |
| Phase 8 | Integration foundation validation + production rollout | Not in this engagement. |

Per spec §23's closing rule: at the end of each phase — migration review, automated tests, responsive QA, permission/isolation tests, demo — **before** moving to the next phase. This ADR and Phase 0/1 will not proceed into Phase 2 regardless of how the conversation continues, unless explicitly re-scoped.

## 6. Open question blocking Phase 0 completion

Prisma schema and folder scaffolding can proceed without a live database. Running real migrations against Production, however, needs an actual Postgres instance to exist — that requires provisioning a resource in your Vercel account (same category of step as adding `GITHUB_TOKEN` earlier). Asked in chat.

## 7. Addendum (post-Phase-1 build): Prisma version corrected from 7.10.0 to 6.19.3

Initial Phase 0 scaffolding pinned `prisma`/`@prisma/client` to `7.10.0` on
the reasoning that it was the last full stable release, ahead of the
`8.0.0-rc.x` release candidate sitting on npm's `latest` tag. That
reasoning about avoiding an RC was correct, but it missed that Prisma 7 is
itself a major, disruptive architecture change versus the 5.x/6.x line
this decision assumed:

- Datasource `url` in `schema.prisma` is removed in favor of a required
  `prisma.config.ts` file.
- Prisma Client requires an explicit driver adapter (`@prisma/adapter-pg`
  + `pg`) instead of the built-in engine — no more zero-config
  `new PrismaClient()`.
- The generator must specify a custom `output` path; Prisma Client is no
  longer generated into `node_modules` by default, so every
  `import ... from "@prisma/client"` site would need to change.
- The package ships ESM-only, which would have required setting
  `"type": "module"` in this repo's `package.json` - a change with
  blast radius far beyond the Time Tracking feature, into tooling the
  existing marketing site depends on.

This was only discovered once a real Vercel Preview build actually ran
`prisma generate` (this sandbox cannot run any `prisma` CLI command at
all - see the "Sandbox note" in README.md - so it wasn't caught earlier).
Adopting all of that for a Phase 1 MVP would have meant a much larger,
riskier diff than the feature itself justifies, and cuts directly against
this engagement's own backward-compatibility instruction.

**Corrected decision: pin to `6.19.3`**, the latest stable release on the
5.x/6.x architecture this ADR and the rest of Phase 0/1's code were
actually written against - inline `datasource.url`, default
`node_modules` output, no driver adapter, no ESM requirement. No other
Phase 0/1 code needed to change as a result; `prisma/schema.prisma` was
already written in the 6.x-compatible form.
