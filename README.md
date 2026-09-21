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

Phases 0-5 of `docs/adr/0001-time-tracking-app-architecture.md`'s plan
are built: audit/schema/environments (0), auth/roles/users/clients/
categories (1), timer + manual time entries + audit revisions (2),
billing policy + hour banks (3), alerts + email delivery (4), and
internal dashboards/reports/CSV export (5). Client Portal + scheduled
reports (Phase 6) and later phases are not built yet - see the ADR's
phased plan for what's still ahead, and don't start it without a fresh
go-ahead.

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
permission, including the three Super-Admin-only screens - Hour Banks,
Alerts, and Integrations), `ANKORA_ADMIN` (clients + categories + time entries + internal
reports, not users, the audit log, hour banks, or alerts), `ANKORA_EMPLOYEE`
(own timer/entries only: `time_entry.create_self` + `time_entry.edit_self`,
never `edit_others`), and `CLIENT_USER` (no admin permissions and no
`time_entry.*` at all - client-facing screens are Phase 6). Note that
`report.internal.view` (Phase 5) is deliberately granted to `ANKORA_ADMIN`
too, unlike `hour_bank.manage` (Phase 3) and `alert.manage` (Phase 4) which
are Super-Admin-only - spec section 4's role table explicitly lists
"דוחות" (reports) under Ankora Admin/Manager but never mentions hour banks
or alerts for that role; see `docs/adr/0001`'s Phase 3/4/5 addenda for the
full reasoning. The full map is `ROLE_PERMISSIONS` in
`lib/app-auth/permissions.ts`; every mutation checks it server-side via
`assertCan()` - nothing is enforced by hiding a nav link alone.

See `docs/roles-permissions.md` for the full role x permission matrix
(kept in sync with `ROLE_PERMISSIONS` directly - regenerate it if they ever
drift, don't hand-edit around a mismatch).

### Schema (Phase 0-2 detail below; full Phase 0-8 model list + diagram in `docs/erd.md`)

The prose below covers Phase 0-2 in detail (the earliest, most
foundational models); Phase 3 (billing/hour banks), Phase 4 (alerts),
Phase 6 (report schedules), and Phase 8 (integrations) each added their
own models, documented inline in `prisma/schema.prisma`'s own per-phase
section comments and in `docs/adr/0001`'s matching addenda. See
`docs/erd.md` for a single diagram covering every model across all
phases, grouped by the phase that introduced it.

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

### Deployment / rollback

Every push to `main` auto-deploys to Production (`ankora.co.il`) via
Vercel's GitHub integration; every other branch gets its own Preview URL.
Phase 8 addendum (spec section 24 checklist: "Deployment rollback
documented") - there is no custom rollback script, because Vercel's own
mechanism already covers it and a custom one would just be a worse copy:

1. Open the project's **Deployments** tab in the Vercel dashboard.
2. Find the last known-good Production deployment (each one is pinned to
   the exact git commit it was built from).
3. Click **"..." -> Promote to Production** on that deployment.

This re-points `ankora.co.il` at the previous build instantly (no
rebuild, no redeploy) - the fastest possible rollback. It does **not**
revert the database: if the bad deploy included a migration, promoting an
older build does not undo that migration, so a schema-changing deploy
should be verified on its own Preview URL (every branch already gets one
automatically) before merging to `main`, exactly as every phase in this
project's own history has done. If a bad migration itself needs undoing,
that is a manual, hand-reviewed SQL operation against the actual
Production database - never something to script blindly, since Prisma
does not auto-generate a safe "down" migration.

### Known limitations (reviewed as of Phase 9)

Phases 0-8 (the full development plan in spec section 23) have all shipped
to Production. Phase 9 (a full spec re-audit, `docs/adr/0001` section 17)
closed five gaps the audit found - `Task.status`, a standalone Tasks
screen, a self-service Profile screen, a Notifications screen, and the
email/persisted half of the long-running-timer warning - plus added
XLSX/PDF export alongside the already-mandatory CSV (spec 14.4 marks
XLSX/PDF "מומלץ", recommended, not mandatory - previously deferred, not a
bug). This list was last accurate for Phase 1 alone and has been
rewritten to describe what is genuinely still a limitation today - not what
was true before timer/billing/alerts/reports/portal/integrations/tasks
existed.

- **No real external integration is connected yet.** `/app/integrations`
  (Phase 8) shows ClickUp as a deliberate placeholder - every mutating
  method on its provider adapter rejects by design (spec 17.3: no OAuth
  scope requested until the integration is actually built). The generic
  `IntegrationConnection`/`ExternalMapping` tables and provider interface
  exist so a real integration can be added later without a schema change.
- **Forecast-based hour-bank alerts and anomaly detection are not
  built.** Spec section 28 explicitly marks these as future ideas, and
  the Phase 4 `AlertThresholdType` enum leaves out the spec-marked-Future
  "Forecast" type - not an oversight, see `docs/adr/0001` section 11.3.
- **Three production-checklist items need Ariel's own action, not code**
  (spec section 24, `docs/adr/0001` section 15.4): a Neon backup/restore
  drill (an operational exercise against the Neon console, not something
  this engagement can run from its sandbox), the external error-tracking
  vendor choice (Sentry vs. Vercel Observability - `/api/health` exists
  either way), and a real-device Safari pass (verified via Chrome device
  emulation across every phase's QA, but that is not the same as a real
  iPhone).
- **Audit log has no export/retention policy UI.** Unchanged since Phase
  1 - it's an append-only table with a read-only filtered viewer;
  retention/export was never a stated acceptance criterion for any phase.

### Claude Desktop (MCP)

`/api/mcp` exposes the Time Tracking app to an employee's Claude Desktop
over the Model Context Protocol. Ten tools:

| | |
| --- | --- |
| Read (own) | `list_my_clients`, `list_categories`, `get_active_timer`, `list_my_time_entries` |
| Write (own) | `start_timer`, `stop_timer`, `update_timer_note`, `create_time_entry` |
| Read (team) | `list_team_members`, `list_team_time_entries` — needs `time_entry.edit_others`, the same permission the admin screen and the CSV export already use |

Entries created through MCP carry `createdVia = MCP`, so they are always
distinguishable from ones typed into the app. Nothing here deletes, and
nothing writes on behalf of another employee — both stay in the UI. The
full reasoning is in `docs/adr/0005-mcp-server.md`.

**Connecting (OAuth).** Add `https://www.ankora.co.il/api/mcp` as a custom
connector in Claude and sign in with your Ankora account. Nothing to
install and no token to copy; Claude acts with your own permissions.

The canonical host matters: the apex redirects to `www`, and the OAuth
`resource` is bound to the URL as typed (RFC 8707), so a connector added
against the bare apex or the `.vercel.app` alias starts a flow whose
resource indicator does not match the one the metadata advertises.

**Where this shows up in the product.** `/app/profile` and
`/app/integrations` both render `ClaudeConnectionCard` — live/not-live
badge, active grants, last use, and the connector URL to copy — and both
link to the setup steps in the in-app guide (`/app/guide#mcp-claude`),
which is also what `resource_documentation` in the RFC 9728 metadata
points at. Liveness is computed in `lib/app-domain/mcp-connections.ts`
against the same checks `lib/mcp/auth.ts` applies, on the refresh horizon
rather than the one-hour access-token one.

**Connecting (legacy bridge).** The Phase 1 stdio bridge and its personal
access tokens still work — see `scripts/mcp-bridge.mjs` and
`scripts/mcp-issue-token.ts`. It needs Node.js locally and a token issued
against the database, which is why the connector replaced it.

Everything runs as the employee whose token is used: the tools call
`lib/app-domain/*` directly, so `assertCan`, the `UserClientAccess`
scoping and the audit trail all apply exactly as they do on screen. There
is no shared or system-level credential.

**1. Issue a token** (needs database access; one per person per machine):

```bash
DATABASE_URL="postgresql://..." npx tsx scripts/mcp-issue-token.ts \
    --email someone@ankora.co.il --label "MacBook Air"
```

The token is printed once and is not recoverable. It expires in 90 days.
List and revoke with `--list` and `--revoke <tokenId>`.

**2. Point Claude Desktop at the bridge.** In
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ankora": {
      "command": "node",
      "args": ["/absolute/path/to/ankora-website/scripts/mcp-bridge.mjs"],
      "env": {
        "ANKORA_MCP_URL": "https://www.ankora.co.il/api/mcp",
        "ANKORA_MCP_TOKEN": "ank_mcp_..."
      }
    }
  }
}
```

Restart Claude Desktop. `scripts/mcp-bridge.mjs` is a dependency-free
stdio↔HTTP relay — it needs Node 20+ and nothing installed.

**Revoking access.** In the product: each grant has its own "ניתוק"
button on the Claude card (`/app/profile`, `/app/integrations`), and an
admin can cut every grant a user holds from that user's page under
`/app/users` — separate from "logout all sessions", which is the blunter
instrument and also ends their browser sessions. Both write an
`AuditEvent` (`mcp_grant.revoke`, `mcp_grant.revoke_all`).

Revocation is a soft revoke (`revokedAt`), never a delete, and there is
no undo — re-authorizing in Claude is the recovery path. An OAuth
disconnect revokes every live row for that client, not only the current
one in the rotation chain, so no rotated-away access token outlives the
click.

Out of band, the old paths still hold: `--revoke <tokenId>` for a
bridge token, and anything that bumps `User.tokenVersion` (a password
change, "logout all sessions", deactivating or soft-deleting the user)
invalidates every grant along with the browser sessions.

**Troubleshooting.** The bridge logs to stderr, which Claude Desktop
surfaces in its MCP log (`~/Library/Logs/Claude/mcp*.log`). A `401` there
means the token is revoked, expired, or the account is no longer active —
issue a new one.

## Not yet built (flagged in the plan, out of v1 scope)

- `/insights` content hub (SEO keyword targets — reserved but empty)
- Real vendor/CRM integration behind the contact form
- Licensed typeface upgrade path (Heebo is the pragmatic default; see plan doc section 5)
