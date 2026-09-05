# Ankora Website

Next.js 14 (App Router) + TypeScript + Tailwind + Framer Motion. Bilingual (Hebrew default/RTL, English toggle) per the approved strategic plan.

## Run locally

```bash
npm install
npm run dev
```

Visit http://localhost:3000 — redirects to /he. Toggle language via the header control (routes to /en).

## Structure

- `app/[locale]/` — the marketing site, duplicated per locale via the dynamic segment (`/he/...`, `/en/...`)
- `content/he.ts`, `content/en.ts` — every string on the site, typed against `content/types.ts`. Edit copy here, never in components.
- `components/sections/` — homepage + page sections
- `components/layout/` — header (with solutions mega menu + language toggle) and footer
- `components/ui/`, `components/motion/` — shared primitives
- `app/(product)/app/` — the Time Tracking product (`/app/...`), a second, independent App Router tree with its own root layout - see "Time Tracking app" below
- `middleware.ts` — Auth.js Edge gate for `/app/*` only (redirects to `/app/login` if there's no session). The marketing site's `/` → `/he` redirect is a platform-level rule in `vercel.json`, not middleware - the two don't interact.
- `tailwind.config.ts` — shared design tokens (navy/gold/paper palette, Heebo type) - reused as-is by both the marketing site and the product

## Notes

- Fonts are self-hosted via `@fontsource/heebo` rather than `next/font/google` — the build environment I worked in blocks Google Fonts' CDN, and self-hosting is more robust for production anyway (no runtime dependency on Google's servers).
- The contact form is UI-only (no backend wired up yet) — it needs an endpoint (email service, CRM webhook, etc.) before launch.
- `/privacy` and `/terms` are placeholders — legal copy still needs to be drafted.
- No services/pricing menu by design — see the strategic plan doc for why.

## Time Tracking app (`/app`)

Phase 0 (audit/schema/environments) and Phase 1 (auth, roles, users,
clients, categories) of `docs/adr/0001-time-tracking-app-architecture.md`.
Phase 2 onward (timer, billing, dashboards, client portal, ...) is not
built - see the ADR's phased plan for what's still ahead, and don't start
it without a fresh go-ahead.

### Stack

Postgres (Prisma ORM) + Auth.js v5 (Credentials, JWT sessions, bcrypt) +
Server Actions. Fully separate from the marketing site's stack (which has
no database) - see the ADR for why it lives at `/app` instead of a
subdomain.

### Local setup

```bash
npm install                 # runs `prisma generate` via postinstall - needs network access
npm run db:dev               # starts a local embedded Postgres (port 55432, db=ankora_dev)
npx prisma migrate deploy    # applies prisma/migrations/*
npm run db:seed              # optional - loads demo fixtures, see below
npm run dev
```

Then set `DATABASE_URL` and `AUTH_SECRET` per `.env.example`. Visit
`/app/login`.

**Deploy-time migrations:** `npm run build` runs `prisma generate && prisma
migrate deploy && node scripts/seed-preview.mjs && next build`, so every
Vercel deployment (Preview and Production) applies any new migrations in
`prisma/migrations/` to its own database automatically - no manual
`prisma migrate deploy` step needed on Vercel. `prisma migrate deploy` is
safe to re-run (only applies migrations not yet recorded as applied), so
this does not touch existing data.

**Auto-seeding on Preview only:** `scripts/seed-preview.mjs` runs
`prisma/seed.ts`'s `[DEMO]`-prefixed fixtures automatically during build,
but only when `VERCEL_ENV=preview` (set by Vercel itself) - it's a no-op
for Production and for local/dev builds. This is safe specifically
because Preview has its own isolated database branch (below), so demo
data never reaches Production.

**Preview database isolation:** the Vercel project's Postgres (Neon) is
configured with Preview Branching enabled for the Preview environment
only (Storage -> ankora-time-tracking -> Projects -> Update Project
Connection). Every Preview deployment gets its own copy-on-write Neon
branch, seeded from Production's schema/data at branch-creation time, so
Preview testing (including running `npm run db:seed`) never touches
Production data. Production intentionally does *not* have branching
enabled - it deploys straight against the primary branch.

**Sandbox note:** the environment this Phase 0/1 work was originally built
in has no network route to `binaries.prisma.sh` (Prisma's engine CDN), so
`prisma generate` / `prisma migrate dev` / `next build` could not be
executed there - every `prisma` CLI subcommand needs that binary, even
`--version`. This is not expected to affect a normal developer machine or
Vercel's build environment (both have full internet access); it only
explains why `prisma/migrations/.../migration.sql` was authored by hand
against `prisma/schema.prisma` and verified by applying it directly to a
local Postgres with a raw SQL client, instead of via `prisma migrate dev`
itself. The first real `prisma migrate dev` run anywhere with network
access should see this migration as already in sync with the schema.
Phase 2's migration was authored and verified the identical way, for the
identical reason - the restriction is environment-wide, not tied to any
one phase.

### Roles & permissions

Four roles (`prisma/schema.prisma`'s `UserRole`): `SUPER_ADMIN` (every
permission), `ANKORA_ADMIN` (clients + categories + time entries, not
users or the audit log), `ANKORA_EMPLOYEE` (own timer/entries only:
`time_entry.create_self` + `time_entry.edit_self`, never `edit_others`),
and `CLIENT_USER` (no admin permissions and no `time_entry.*` at all -
client-facing screens are Phase 6). The full map is `ROLE_PERMISSIONS` in
`lib/app-auth/permissions.ts`; every mutation checks it server-side via
`assertCan()` - nothing is enforced by hiding a nav link alone.

### Schema (Phase 0-2 scope)

Phase 0/1: `User` (internal staff + client-portal users share one table;
role or per-client `ClientUser` membership determines authority),
`Client`, `Category` (global or client-specific), `UserClientAccess`
(which clients an employee may work with), `ClientUser` (a client-portal
user's membership + role in one client - not yet wired to any UI,
reserved for Phase 6), `PasswordResetToken`, `AuditEvent` (append-only).

Phase 2 (spec 23: "Timer + TimeEntry + manual entry + audit revisions"):
`Task` (free-text-first per spec 6.1; only enough is modeled for
`TimeEntry.taskId` to point somewhere), `TimeEntry` (a row with
`endAt = null` is a running timer; `actualSeconds`/`billableSeconds` are
always server-computed, never client-trusted), `TimeEntryRevision`
(immutable, one row per edit, `(timeEntryId, version)`-unique). The
single-active-timer-per-user constraint (spec 18.2) is a raw Postgres
partial unique index that only exists in the hand-authored migration SQL
- see `prisma/schema.prisma`'s Phase 2 header comment and
`docs/adr/0001-time-tracking-app-architecture.md` section 8 for why
Prisma's schema DSL can't express it. See the model comments in
`prisma/schema.prisma` for what's still deliberately deferred (HourBank,
BillingPolicy, AlertRule, etc.).

### Seed data

`npm run db:seed` loads demo fixtures - a `SUPER_ADMIN`, an
`ANKORA_ADMIN`, two `ANKORA_EMPLOYEE`s (each assigned to a different
demo client, useful for testing client isolation), one `SUSPENDED`
employee (for testing the login-blocked acceptance criterion), two demo
clients, and a few categories. Every seeded record's name is prefixed
`[DEMO]`. Shared password is printed to the console when the script runs.
**Never run this against Production** - see `prisma/seed.ts` for the full
rationale.

### Tests

```bash
npm run test              # unit tests only - no database needed
npm run test:integration  # needs a real DATABASE_URL + generated Prisma Client
npm run test:all          # both
```

Unit tests (`tests/unit/`) cover password policy, permission checks, and
lockout-window logic - pure functions, no I/O. Integration tests
(`tests/integration/`) cover login (including the suspended-user and
graduated-lockout acceptance criteria), password reset end-to-end, RBAC
enforcement, and client-access isolation, against a real Postgres
database - they truncate all tables before each test, so point
`DATABASE_URL` at a throwaway local/dev database, never Production.

### Known limitations (Phase 1, by design)

- **No email provider yet** (Phase 4) - invite links and password-reset
  links are surfaced directly in the admin UI / server action response for
  the inviting admin to relay manually, instead of pretending an email was
  sent.
- **`ClientUser` (client-portal membership) exists in the schema but has
  no UI yet** - the actual client portal is Phase 6.
- **No timer/TimeEntry/billing** - Categories exist so Phase 2 has
  somewhere to point, but nothing reports time against them yet.
- **Audit log has no export/retention policy UI** - it's an append-only
  table with a read-only filtered viewer; retention/export is not a Phase
  1 acceptance criterion.

## Not yet built (flagged in the plan, out of v1 scope)

- `/insights` content hub (SEO keyword targets — reserved but empty)
- Real vendor/CRM integration behind the contact form
- Licensed typeface upgrade path (Heebo is the pragmatic default; see plan doc section 5)
