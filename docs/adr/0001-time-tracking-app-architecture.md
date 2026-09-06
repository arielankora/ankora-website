# ADR-0001: Time Tracking App — Architecture Decision Record

Status: Implemented (Phases 0-7 shipped to Production; Phase 8 in progress)
Date: 2026-09-04 (last status update: Phase 8 addendum, section 15)
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
| DB provider | **Decided in Phase 0 and in production use since: Vercel Postgres (Neon-backed, via Vercel's Marketplace/Managed Integration) — same dashboard/env-var flow already used for the blog, with Neon's branching feature giving every Preview deployment its own isolated database branch.** This row was left saying "Open — needs your decision" long after the decision was actually made and shipped (Phase 0, task #98) — a stale-documentation gap this Phase 8 addendum corrects; see section 15. |
| ORM/migrations | **Prisma** — mature migration tooling, TypeScript types generated from schema, easiest to review migrations as plain SQL diffs (spec explicitly requires migration review at the end of every phase). |
| Auth | **Auth.js (next-auth) v5, Credentials provider + bcrypt password hashing + Prisma adapter.** Not a paid SaaS auth vendor (Clerk/Auth0) — no new cost, no new third party holding Ankora's user data, but a well-audited library rather than hand-rolled crypto for something this security-sensitive (multi-tenant client isolation, session security, rate limiting are all explicit spec requirements in §16.2). |
| Rate limiting | In-memory/DB-backed sliding window on the login endpoint for MVP (no Redis dependency yet; documented as a known limitation if traffic ever requires a shared store across serverless instances). |
| Testing | Vitest for unit/integration tests (fast, TS-native, no config baggage); Playwright for the E2E scenarios in spec §21.3, run against a seeded test database. |

## 5. Phased plan (spec §23), mapped to this engagement

| Phase | Spec scope | This session |
|---|---|---|
| **Phase 0** | Repo/hosting/design audit; ADR; DB schema; environments | **This document** + Prisma schema modeling spec §5 + folder scaffolding + `.env.example` + README additions. In progress now. |
| **Phase 1** | Auth, roles, users, clients, categories | Next, after Phase 0 acceptance criteria pass. |
| **Phase 2** | Timer + TimeEntry + manual entry + audit revisions | **Built in this session** (see section 8 below), on `feature/time-tracking-phase2`, PR opened for review — not merged without explicit approval. |
| Phase 3 | Billing policy + hour bank + live client snapshot | Not in this engagement. |
| Phase 4 | Alerts + email delivery logs | Not in this engagement. |
| Phase 5 | Internal dashboards + reports + exports | Not in this engagement. |
| Phase 6 | Client portal + scheduled reports | Not in this engagement. |
| Phase 7 | PWA/mobile polish + performance + security hardening | Not in this engagement. |
| Phase 8 | Integration foundation validation + production rollout | Not in this engagement. |

Per spec §23's closing rule: at the end of each phase — migration review, automated tests, responsive QA, permission/isolation tests, demo — **before** moving to the next phase. Phase 0/1 did not proceed into Phase 2 until explicitly re-scoped and re-authorized (see section 8).

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


## 8. Addendum: Phase 2 (Timer + TimeEntry + manual entry + audit revisions)

Phase 0/1 shipped and merged to Production first (`feature/time-tracking-phase0` → `main`,
commit `238d8c2`). Phase 2 was explicitly re-authorized afterward and scoped strictly to
spec §23's own Phase 2 line: Timer, TimeEntry, manual entry, and audit revisions. Everything
else spec §5 models for later phases (HourBank, AlertRule, BillingPolicy, EmailDelivery,
IntegrationConnection, ExternalMapping) remains unmodeled — adding those tables now would be
scope creep the spec itself schedules for Phase 3+.

### 8.1 Schema

Three new models, following the exact conventions Phase 0/1 established (UTC timestamps,
`deletedAt` soft delete, `@@map` snake_case tables):

- **`Task`** — spec §6.1: "Task יכולה להיות free-text ב-MVP אך נשמרת כישות אם המשתמש בוחר
  'צור משימה'." Modeled now (with the ClickUp-shaped `source`/`externalRef` columns spec §10
  already specifies) so `TimeEntry.taskId` has somewhere to point, but Phase 2's actual UI
  never requires creating one — a `TimeEntry.note` free-text field covers the MVP flow.
- **`TimeEntry`** — a row with `endAt = null` *is* a running timer (`source = TIMER`); manual
  entries (`source = MANUAL`) always have both timestamps set at creation. `actualSeconds` /
  `billableSeconds` are server-computed only (spec §18.1: "server end time + compute actual"),
  never trusted from the client, and null while a timer runs. `billableSeconds` defaults equal
  to `actualSeconds` — no `BillingPolicy` exists yet to diverge them (spec §7); modeling the
  column now avoids a Phase 3 backfill migration.
- **`TimeEntryRevision`** — immutable, `(timeEntryId, version)`-unique audit trail created on
  every post-creation edit (spec §5.1: "כל עריכה ל-start/end/client/category/task/note/billable
  duration יוצרת Revision"). Never updated or deleted itself.

**Concurrency constraint that cannot live in `schema.prisma`.** Spec §18.2 requires "concurrent
start requests create max one active timer." Prisma's schema DSL has no portable syntax for a
partial/filtered unique index (unique per user only among rows where `end_at IS NULL`), so this
is a raw Postgres index added directly in the hand-authored migration SQL:

```sql
CREATE UNIQUE INDEX time_entries_one_active_per_user
  ON time_entries (user_id) WHERE end_at IS NULL;
```

This is documented at length in `schema.prisma`'s own header comment for the Phase 2 section,
so a future `prisma migrate dev` run (once this sandbox's network restriction no longer
applies — see section 7 above and README.md's "Sandbox note") doesn't silently drop it as
"drift." Application code (`lib/app-domain/time-entries.ts`) also pre-checks for a friendlier
error message, but the database constraint is the actual race-safe guarantee — verified
functionally (not just structurally) against a local Postgres: two concurrent `INSERT`s with
`end_at IS NULL` for the same user, second one correctly rejected with `23505`.

**Idempotent timer stop** (spec §18.2: "בקשת Stop חוזרת עם אותו idempotency key לא יוצרת Entry
כפול"): implemented as a conditional `UPDATE ... WHERE id = ? AND end_at IS NULL` (Prisma
`updateMany`, checking the affected-row count), rather than a separate idempotency-key table.
A duplicate/double Stop request naturally no-ops on the second call and just re-reads the
already-stopped row.

### 8.2 Permissions

Phase 2 adds the three permission strings spec §4.1 itself names as its example granular list,
verbatim: `time_entry.create_self`, `time_entry.edit_self`, `time_entry.edit_others`. No
separate `timer.use` permission exists — starting/stopping a timer is just creating/updating a
`TimeEntry` with `endAt` initially null, so it's covered by the same two permissions manual
entries use. Role assignment follows spec §4's role table directly: `ANKORA_EMPLOYEE` gets
`create_self`/`edit_self` only (own timer/entries, self-edit window applies); `ANKORA_ADMIN`
and `SUPER_ADMIN` additionally get `edit_others`; `CLIENT_USER` gets none, per spec §4.1's
explicit rule that a client never gets edit permission on Ankora's time entries in the MVP.

### 8.3 Client isolation

Spec §4.1: "אסור לעובד לדווח זמן ללקוח שאינו משויך אליו, אלא אם יש הרשאת override." Enforced in
`lib/app-domain/time-entries.ts` via `canAccessClientForTimeEntry()`, checked on every write
(start timer, manual entry, edit that changes client) against the `UserClientAccess` table
established in Phase 1 — with `client.manage` acting as the "override" permission spec §4.1
describes, letting admins act across any client including on an employee's behalf.

### 8.4 Business rules implemented exactly as spec-worded

- **Overlap validation** (§6.3): half-open interval check against the user's other entries;
  blocked unless the actor holds `time_entry.edit_others` *and* the caller explicitly passed an
  override flag — never silently allowed.
- **Self-edit window** (§6.4): 48 hours, the concrete number the spec itself offers as an
  example ("עד סוף היום/48 שעות"), past which only `edit_others` (Manager+) can still edit.
- **Backdate reason** (§6.3): any manual entry whose calendar date (Asia/Jerusalem) differs
  from today's requires a non-empty reason.
- **Admin-on-behalf-of-employee entries** (§6.3): `actorId` (who performed the write) and
  `TimeEntry.userId` (whose time it is) are recorded as distinct fields — never conflated —
  satisfying "actor שונה מ-user_id ונרשם ב-Audit."
- **Soft delete only** (§5.1): no hard `DELETE` anywhere in the app layer.

### 8.5 Screens built (spec §11 employee screens, §12 admin screens)

- `/app/timer` — Today/Timer (§11, §6.2 "Quick Timer"): big Start/Stop, elapsed time ticking
  client-side off the server-recorded `startAt`, recent client+category combinations, long-timer
  warning banner (8h) that does not auto-stop.
- `/app/my-time` — My Time (§11): week-by-week entry list grouped by day, manual entry form,
  inline self-edit respecting the edit window, "נערך" (Edited) badge (§6.4).
- `/app/time-entries` — Admin Time Entries (§12): cross-client table with client/employee/date
  filters, inline edit with overlap-override checkbox, lazy-loaded revision history per entry,
  and an admin "enter time for an employee" form.

Everything spec §11/§12 lists beyond these three screens (Tasks, Client Snapshot, Notifications,
Profile, Overview, Hour Banks, Reports, Alerts, Integrations) is out of Phase 2's stated scope
and deferred to the phase that actually models the underlying entities.

### 8.6 Known limitation carried forward unchanged

This sandbox still cannot reach `binaries.prisma.sh` (see section 7's "Sandbox note" reference),
so `prisma generate` cannot run here and the locally-generated `@prisma/client` remains a stale
placeholder typed `any` throughout this repo (Phase 0/1 code included, not just Phase 2's new
files) — confirmed by inspecting `node_modules/.prisma/client/default.d.ts` directly. Local
`tsc --noEmit` therefore cannot fully type-check Prisma-touching code in this environment; every
error it reports on this branch traces to that one root cause (`export declare const
PrismaClient: any`), not to a real type mismatch — verified by diffing the error list against
files untouched by Phase 2. The migration itself was independently verified by hand: applied
directly to a local embedded Postgres via a raw `pg` client, including a functional test of the
partial unique index under a simulated race. Full type-checked build verification happens where
it always has for this project — Vercel's Preview build, which has normal internet access and
runs the real `prisma generate` as the first step of `npm run build`.

## 9. Addendum: Phase 3 (Billing policy + hour bank + live client snapshot)

Phase 2 shipped and merged to Production first (PR #2 → `main`). Phase 3 was explicitly
re-authorized afterward ("אתה יכול להתקדם לשלב שלוש") and scoped strictly to spec §23's own
Phase 3 line: Billing policy, hour bank, live client snapshot. Everything else spec §5 models
for later phases (AlertRule, EmailDelivery, IntegrationConnection, ExternalMapping) remains
unmodeled.

### 9.1 Schema

Three new models plus four enums, following the same conventions as Phase 0-2:

- **`BillingPolicy`** — one row per client (`clientId @unique`), spec §7.1's field list
  verbatim (`minimumMinutes`, `incrementMinutes`, `roundingMode`, `aggregationScope`). A client
  with no row uses the neutral default (0 minimum, 1-minute increment, `EXACT` rounding,
  `PER_ENTRY` scope) - a documented no-op that keeps every existing Phase 2 entry's
  `billableSeconds` identical to `actualSeconds` unless an admin explicitly configures a policy.
  Spec §7.1's "Employee override" row is intentionally not modeled - no such permission exists
  yet, and building the structure for a not-yet-real permission is the speculative scope creep
  spec §25 itself warns against.
- **`HourBank`** — one row per client per cycle (`@@unique([clientId, cycleStart])`), spec §5 +
  §8's field list plus two fields the spec's field list doesn't name a home for:
  `rolloverMode` and `rolloverCapMinutes`. **Product decision**: these live on the cycle that
  *produces* the rollover (the ending cycle), not on a separate settings entity the spec never
  describes - `openHourBankCycle()` reads the *previous* cycle's `rolloverMode`/`rolloverCapMinutes`
  to compute the *new* cycle's `rolloverInMinutes`. `consumedMinutes` is a cached snapshot only,
  recomputed from live `TimeEntry` data on every read (`getHourBankSnapshot()`) - never trusted
  as the source of truth, exactly like `TimeEntry.actualSeconds` is never trusted from the client.
- **`HourBankAdjustment`** — spec §8.2's "manual adjustments," signed minutes (positive credit /
  negative debit) with a required `reason` and `createdById`. `hourBankId` is an added
  convenience FK (nullable, `SetNull` on delete) so an adjustment survives its cycle being
  deleted, matching the spec's own emphasis that the audit trail must outlive individual records.

**Enums**: `RoundingMode` (CEIL/NEAREST/EXACT), `BillingAggregationScope`
(PER_ENTRY/PER_TASK_PER_DAY/PER_DAY), `RolloverMode` (NONE/FULL/CAPPED/MANUAL), `HourBankStatus`
(OPEN/CLOSED/RECALCULATED).

**Aggregation scope - a genuine spec ambiguity, resolved and documented.** Spec §7.1 describes
"per entry / per task per day / per day" as the granularity at which the minimum/rounding rules
apply, but never specifies how a rounded *group* total should be split back across its sibling
entries - there is no well-defined answer. **Product decision**: every `TimeEntry` always keeps
its own true per-entry `billableSeconds` (transparency in reports/revision history, unchanged
from Phase 2); the aggregation scope only affects the separately-computed Hour Bank *consumption*
total (`computeConsumedMinutesForRange()` in `lib/app-domain/billing.ts`), which groups raw
`actualSeconds` per the configured scope and applies the policy once per group before summing.
`PER_ENTRY` (the default) is simply the sum of each entry's own `billableSeconds` - identical to
Phase 2 behavior.

Migration hand-authored for the same reason as Phase 2 (`docs/adr` section 8.1/8.6): this
sandbox cannot reach `binaries.prisma.sh`. Verified functionally against a local embedded
Postgres via a raw `pg` client (not the stale Prisma Client) - 7 assertions covering unique
constraints on `BillingPolicy.clientId` and `HourBank(clientId, cycleStart)`, and correct
CASCADE vs. `SetNull` behavior on all five foreign keys.

### 9.2 Permissions

Adds `hour_bank.manage` - spec §4.1's own example permission list names it verbatim. Spec §4's
role table lists "banks" under Super Admin's row only, silent under Ankora Admin/Manager's own
row. Following the identical precedent already established for `audit.view` in Phase 2, that
silence is treated as deliberate: `hour_bank.manage` stays **Super-Admin-only**, even though
`ANKORA_ADMIN` already holds `client.manage`. Regression-tested in `tests/unit/permissions.test.ts`.

### 9.3 Business rules implemented exactly as spec-worded

- **Billable vs. actual divergence** (§7): `lib/app-domain/time-entries.ts`'s three
  billable-seconds assignment sites (`stopTimer`, `createManualEntry`, `updateTimeEntry`) now
  call `computeEntryBillableSeconds()` instead of hard-coding `billableSeconds = actualSeconds`.
- **Cycle lifecycle** (§8.2): `OPEN` is the default; a lazy check on every read
  (`closeIfExpired()`) flips a cycle to `CLOSED` once `cycleEnd` has passed - no cron job exists
  in this engagement, so this is computed as a pure function of "now" on read rather than via
  background infrastructure. Opening a new cycle also proactively closes the previous `OPEN`
  one, so two cycles are never simultaneously `OPEN` for the same client.
- **Recalculation flag** (§8.2: "אין לשנות silently דוח שכבר הופק ללא log"): a backdated
  `TimeEntry` edit or delete, or a manual adjustment, that lands inside an already-`CLOSED`
  cycle's date range flips that cycle to `RECALCULATED` with a `recalculatedAt` timestamp
  (`flagAffectedCyclesRecalculated()`), wired as a best-effort post-commit step in
  `updateTimeEntry`/`deleteTimeEntry` - it must never roll back the entry write itself.
- **Utilization formula** (§8.3): `total = purchased + rolloverIn + adjustments`,
  `remaining = total - consumed`, `utilization% = consumed/total*100`, explicitly guarded
  against divide-by-zero (0% on an empty bank, never `NaN`/`Infinity`). Utilization is allowed
  to exceed 100% when a client overruns its bank - the spec never says to clamp it, and hiding
  an overrun would work against the whole point of the Hour Bank feature.

### 9.4 Screens

Not yet built as of this addendum - `/app/hour-banks` (spec §12: "current/historical cycles,
adjustments, utilization") is the next piece of Phase 3 work, gated on `hour_bank.manage`.

### 9.5 Known limitation carried forward unchanged

Same root cause as Phase 2 (section 8.6): this sandbox still cannot reach
`binaries.prisma.sh`, and in this session that limitation is more severe than previously
observed - `@prisma/client` is not just stale but fails to *initialize* at all
(`new PrismaClient()` throws `"@prisma/client did not initialize yet"`), which blocks running
**any** Vitest suite that imports a module touching `lib/prisma.ts` - confirmed this is not a
Phase-3-specific regression by reproducing the identical failure on Phase 2's own pre-existing
`tests/unit/time-entries.test.ts`. Phase 3's pure-function logic (`applyBillingPolicy()`,
`computeUtilization()`, `computeRolloverInMinutes()`) was independently cross-checked via a
standalone Node script reimplementing the same math outside the Prisma import chain - all 24
assertions passed. Test files for Phase 3 (`tests/unit/billing.test.ts`,
`tests/unit/hour-banks.test.ts`, `tests/integration/billing.test.ts`,
`tests/integration/hour-banks.test.ts`) are written and structurally consistent with Phase 1/2's
suites; their actual pass/fail confirmation, like every prior phase's, happens on Vercel's
Preview build and live QA, which has normal internet access.

## 10. Standing rule: the in-app user guide (`/app/guide`) must stay current

Ariel asked (2026-09-05) for an in-app, Hebrew-language user guide covering every
capability the app has - what it does, who can access it (exact role list, not a
guess), how to use it step by step, and a real screenshot of the relevant screen -
so that any new user granted access can understand the system on their own.

This is now a **standing rule for every future change to this app**, on the same
footing as "preserve backward compatibility" and "document decisions" from this
engagement's original instruction:

> Any commit that adds a new screen/capability, or changes what an existing
> screen/capability does or who can access it, must update the matching entry
> in `app/(product)/app/guide/content.ts` in the SAME change - new section for a
> new capability, edited `roles`/`description`/`steps` for a changed one, and a
> refreshed screenshot in `public/guide/` if the screen's layout changed
> meaningfully. A phase/feature is not "done" until the guide reflects it,
> exactly like a phase is not done until its migration and tests are done.

Why a repo-committed rule rather than relying on a chat-level reminder: this
engagement's whole continuity model already depends on a fresh session reading
the spec and this ADR before touching code (see the original standing
instruction), so writing the rule here - where every future session is already
guaranteed to look - is the durable place for it, not something that depends on
a particular chat's memory surviving between sessions.

`content.ts` is deliberately a separate data file from `page.tsx` (which only
renders it) specifically so "update the guide" has one obvious, small place to
edit rather than requiring touching JSX.

### 10.1 What the guide covers as of this addendum

Every screen that exists in the app today: login, forgot/reset password, the
role model itself, the Overview home page, Timer, My Time, Clients, Categories,
the admin Time Entries table, Users, Audit Log, and Hour Banks (Phase 3).

One honest gap, documented in the guide itself rather than glossed over: the
`CLIENT_USER` role exists in the data model (spec 4) but spec 11's "Client
Snapshot" and spec 13's "Client Portal" - the screens that would actually make
that role useful - are not built in any phase shipped so far, and the current
"Invite User" form doesn't even offer `CLIENT_USER` as a selectable role. A
`CLIENT_USER` who somehow logged in today would see only the Overview page's
empty state. The guide says this plainly (section "תפקיד הלקוח") instead of
describing screens that don't exist.

## 11. Addendum: Phase 4 (Alerts + email delivery)

### 11.1 Email provider

The spec (section 3.2) calls for "Email provider עם Delivery logs" without naming one. Rather than picking a new provider, Ariel confirmed the marketing site already sends email through Resend (`app/api/contact/route.ts`, using `RESEND_API_KEY` and a verified `ankora.co.il` sending domain). Phase 4 reuses that exact provider and domain: `lib/email.ts` is a small generic `sendEmail()` wrapper around the same Resend REST endpoint the contact form already calls successfully in both Production and Preview (the API key is configured for both environments). The contact route itself is left untouched - `lib/email.ts` is new, not a refactor of existing working code, to keep this change's blast radius limited to the time-tracking app.

Sending address: `Ankora <alerts@ankora.co.il>`. Resend verifies at the domain level, so any local-part at an already-verified domain is deliverable - this is the standard Resend behavior, not a new domain-verification step.

This also resolves the "no email provider" limitation flagged in the Phase 1 addendum (forgot-password) and the guide's honest gap note - though wiring `lib/email.ts` into the password-reset/invite flows themselves is out of scope for Phase 4 and left for a future, explicitly-scoped change (touching auth flows deserves its own review, not a drive-by while building Alerts).

### 11.2 Permission

`alert.manage` is SUPER_ADMIN-only, same reasoning as `hour_bank.manage` in the Phase 3 addendum: spec section 12 lists "Alerts" as an admin screen alongside "Hour Banks", and alert thresholds are defined per-client against the same billing-sensitive hour-bank data Ankora Admin/Manager was deliberately excluded from in Phase 3. No spec text grants Ankora Admin any alert capability, so the same conservative default applies.

### 11.3 Schema decisions where the spec is silent

- **AlertRule.recipientsAnkora / recipientsClient**: spec 9.1 says each rule has "recipients נפרדים ל-Ankora וללקוח" but doesn't specify a format. Stored as Postgres `String[]` (email addresses), matching Prisma's native array support - no new join table needed for what is just a short list of addresses per rule.
- **AlertRule.allowRetrigger**: spec 9.2's exact words - "ברירת מחדל: לא לשלוח שוב באותו cycle אלא אם rule.allow_retrigger=true" - already names this exact field, so it's modeled as specified, defaulting to `false`.
- **Forecast threshold type**: spec 9.1's own table marks this row "Future" explicitly. Not implemented - `AlertThresholdType` has four members (UTILIZATION_PCT, REMAINING_MINUTES, CONSUMED_MINUTES, OVERAGE), not five. This is spec-directed, not a gap.
- **Dedupe/retrigger mechanics**: spec 9.2 requires firing "only when crossing the threshold from below to above" and, when `allowRetrigger=false`, never firing again in the same cycle. Implemented via `AlertEvent.resolvedAt`: evaluation on every relevant mutation checks current utilization; when it clears below threshold, any unresolved event for that (rule, hourBank) pair is marked resolved (no email sent for the resolve itself - spec doesn't ask for one). A rule fires when utilization is at/above threshold AND either no event has ever existed for that (rule, hourBank) pair, or (`allowRetrigger=true` AND every prior event for that pair is already resolved). This is a deliberate, documented interpretation - the spec names the `dedupe_key` concept but not its exact algorithm.
- **EmailDelivery granularity**: one row per logical send action (Ankora recipients and client recipients are separate rows when both lists are non-empty on a rule), not one row per individual recipient address - matches the spec's own field list (`recipients` plural on one row).
- **Client-facing email content**: spec 9.2 lists required fields (client name, total bank, consumed, remaining, utilization %, cycle date, "link to portal"). No Client Portal exists yet (section 13, still unbuilt per the guide's own honest gap note), so the portal-link line is omitted from the client email body rather than pointing at a page that doesn't exist. This will need revisiting once Phase 6 (Client Portal) ships.
- **Retry/backoff**: spec 9.2 wants "retry עם exponential backoff" on delivery failure. This engagement has no job queue or sub-daily scheduler - only a once-daily Vercel Cron (see 11.4). True exponential backoff (minutes/hours between attempts) isn't achievable at that granularity. The implemented approximation: the daily cron retries any `EmailDelivery` row with `status=FAILED` and `attempts < 5`, once per day, and logs an internal audit entry once a delivery has failed all 5 attempts ("N failures - internal warning לאדמין" per spec). This is a documented, coarser-than-spec tradeoff, not a silent gap.

### 11.4 Trigger points

Immediate evaluation (spec 9.2: "בדיקה מיד לאחר כל Stop/Create/Edit/Delete שמשנה billable time") is wired into `lib/app-domain/time-entries.ts`'s `stopTimer`, `createManualEntry`, `updateTimeEntry`, `deleteTimeEntry` - each call is best-effort and non-fatal (`.catch(console.error)`), matching the exact pattern already established for `flagAffectedCyclesRecalculated` in Phase 3, so an alert-evaluation failure can never roll back or block the underlying time-entry write. `lib/app-domain/hour-banks.ts`'s `recordHourBankAdjustment` also triggers evaluation - not explicitly named in spec 9.2's trigger list, but a manual credit/debit changes the same total-minutes number a threshold is measured against, so skipping it would leave a real gap the spec's intent clearly wants covered. This is a deliberate, documented extension of the literal trigger list, not scope creep into a new area.

The daily scheduled reconciliation (spec 9.2's second requirement, "scheduled reconciliation פעם ביום") runs via Vercel Cron hitting `/api/cron/alerts-reconcile` at `0 5 * * *` (05:00 UTC, ~07:00-08:00 Israel time depending on DST - chosen as an early-morning slot with no documented spec preference), which re-evaluates every client with an OPEN hour bank and also drives the retry logic described in 11.3. The route is protected by a `CRON_SECRET` env var checked against the `Authorization: Bearer` header Vercel's Cron infrastructure sends automatically - this needs to be added to the Vercel project's Production and Preview environment variables (same mechanism as `AUTH_SECRET` in Phase 0) before the cron can run for real; Preview QA for this phase (Task #148) will call the route directly with the header to verify it without waiting for the schedule.

### 11.5 What Phase 4 does not include

- Scheduled weekly/monthly reports (spec section 15) - that's Phase 6, not Phase 4.
- The Forecast threshold type (explicitly marked "Future" in spec 9.1).
- Any change to the forgot-password/invite email flows - `lib/email.ts` exists and is proven, but wiring it into auth is a separate, explicitly-scoped future change.

## 12. Addendum: Phase 5 (Internal dashboards + reports + exports)

### 12.1 No new schema

Every report in this phase is a read-only aggregation over data Phases 1-4 already
persist (`TimeEntry`, `HourBank`, `AlertRule`/`AlertEvent`, `User`, `Client`, `Category`).
`ReportSchedule` - the one report-related model spec section 5 lists - is deliberately
**not** added here: it exists to persist a *recurring email schedule* (spec section 15,
"דוחות מתוזמנים במייל"), which is explicitly Phase 6 scope per spec section 23
("Phase 6 | Client portal + scheduled reports"). Adding it now, unused, would be the
same scope creep every prior phase's schema comments warn against.

### 12.2 Permission: `report.internal.view`

Unlike `hour_bank.manage` (Phase 3) and `alert.manage` (Phase 4), which are both
Super-Admin-only because spec section 4's role table is silent on them for Ankora
Admin/Manager, `report.internal.view` **is** named in spec 4.1's own example
permission list, and Ankora Admin/Manager's own role-table row explicitly includes
"דוחות" (reports): "לקוחות/קטגוריות/דוחות/עריכות לפי הרשאה." So this permission is
granted to both `SUPER_ADMIN` and `ANKORA_ADMIN` - the opposite default from the two
prior phases, and consistent with treating an explicit spec grant differently from an
explicit spec silence (the same distinction the Phase 2/3/4 comments already draw in
`permissions.ts`). `ANKORA_EMPLOYEE` and `CLIENT_USER` get nothing here: spec 4's
Employee row never mentions reports, and `report.client.view` (client-facing reports,
spec section 13's Client Portal) is a separate, still-unbuilt permission reserved for
Phase 6.

### 12.3 The nine internal report types (spec 14.2)

All nine rows of spec 14.2's table are implemented in `lib/app-domain/reports.ts`,
sharing one `fetchEntries()` query builder wherever the report is a per-TimeEntry
aggregation, plus a single `runReport(actor, type, filters)` entry point used by BOTH
the `/app/reports` screen and the CSV export route - one function, one permission
check, so the two can never show different numbers for what claims to be the same
report (spec 14.4: "Export מופק server-side עם אותן הרשאות כמו המסך").

Decisions the spec's one-line-per-report table doesn't spell out:

- **Total Client Hours**: read literally as an overall summary (entry count, distinct
  client count, actual/billable minutes) over whatever scope the filters select, not a
  per-client breakdown - that's "Hours by Client" below, which owns the per-client view.
- **Hours by Client**: reads the SAME live current-cycle `HourBank` snapshot the Hour
  Banks screen (Phase 3) already computes via `getCurrentHourBank()`, rather than
  re-deriving used/remaining/utilization from the report's own date-range filter.
  "Used/remaining/utilization" are cycle-scoped concepts (spec 8.3), not period-scoped
  ones - applying an arbitrary `from`/`to` to them would produce a number that
  disagrees with the Hour Banks screen an admin would naturally cross-check against.
- **Employee x Client Matrix vs. Capacity**: spec 14.2 describes these almost
  identically ("מי עובד כמה עבור כל לקוח" vs. "שעות עובד בתקופה + חלוקה ללקוחות").
  Implemented as two different shapes of the same underlying per-(employee, client)
  aggregation: the Matrix is flattened to one row per (employee, client) pair for
  anyone who wants every individual pairing; Capacity is one row per EMPLOYEE with
  their period total plus a single composite "client: minutes; client: minutes" text
  cell, for an at-a-glance capacity view without the full cross-tab. Documented rather
  than silently picking one and dropping the other.
- **Manual Edits**: `isManual` and `isEdited` are independent flags (spec 6.3/6.4) - an
  entry can be one, the other, both, or (most commonly) neither. This report includes a
  row for EITHER flag being true, with "actor"/"reason" taken from the entry's latest
  `TimeEntryRevision` (falling back to the original reporting employee and an empty
  reason when an entry is manual but was never subsequently edited, since only edits
  produce a revision row - spec 6.1/6.4).
- **Overage / At Risk**: "Overage" = utilization at/over 100% (or literally negative
  remaining minutes). "At risk" ("קרובים אליו") needed a concrete cutoff the spec
  doesn't define. Rather than inventing an unrelated second threshold, this reuses each
  client's OWN lowest enabled `UTILIZATION_PCT` alert rule (Phase 4) as the "close to
  it" cutoff - the earliest warning an admin already configured for that specific
  client - falling back to a documented default of 80% for a client with no such rule
  configured yet. This ties Phase 5 directly back to Phase 4's existing per-client
  configuration instead of introducing a disconnected, unconfigurable concept.
- **Active Timers**: excluded from every other report's `fetchEntries()` (which
  requires `endAt IS NOT NULL`, since a running timer has no `actualSeconds`/
  `billableSeconds` yet) and given its own query, matching spec 14.2's own separate
  table row. "Long-running" reuses the same `LONG_TIMER_HOURS = 8` constant as the new
  Overview anomaly card (12.4 below) and spec 6.1's own example ("8/12 שעות
  configurable") - a literal constant for now since no per-client/per-org configuration
  UI exists for this threshold in any phase shipped so far, exactly like Phase 3's
  `DEFAULT_POLICY` was a documented literal default before any config screen existed
  for it.

### 12.4 Overview screen KPI cards (spec section 12)

Spec 12's Overview row lists five KPIs the original Phase 1 landing page (a plain
active-client/category/user count) never covered: "active timers, total today/month,
client utilization, alerts, overdue anomalies." All five are now on `/app`, gated on
`report.internal.view` (so `ANKORA_EMPLOYEE` keeps seeing today's simple state, per
spec 12's own placement of "Overview" in the ADMIN screens table, not spec 11's
employee-facing one) - except the "alerts" card specifically, which stays gated on the
separate `alert.manage` permission, matching the existing precedent that alert data is
Super-Admin-only (Phase 4 addendum, 11.2) even for an `ANKORA_ADMIN` who now sees every
other new KPI. "Client utilization" is the average `utilizationPct` across every active
client's current Hour Bank cycle (Phase 3's own live snapshot, not re-derived), with a
secondary count of clients at/over 90% highlighted - a deliberately simple summary
rather than duplicating the full "Overage/At Risk" report's per-client detail, which is
one click away via the new "לכל הדוחות הפנימיים" link. "Overdue anomalies" is
implemented as the count of currently-running timers already past `LONG_TIMER_HOURS`
(8h) - the same anomaly spec 6.1 already asks the Timer screen to warn about, now
surfaced in aggregate for admins.

### 12.5 Export: CSV mandatory, XLSX/PDF deferred

Spec 14.4: "CSV חובה. XLSX מומלץ. PDF לדוחות לקוח מומלץ." Only CSV is implemented in
this phase - the other two are explicitly "מומלץ" (recommended), not "חובה"
(mandatory), in the same spec sentence, and PDF is scoped to *client* reports (spec
14.1's table), which don't exist until Phase 6's Client Portal. No CSV/XLSX library was
already a dependency of this repo, so CSV is hand-written (`app/api/reports/export/route.ts`):
minimal RFC 4180 field escaping, a UTF-8 BOM prefix so Hebrew opens correctly in Excel
(spec 14.4, explicit requirement), and a filename of `{report}_{client-or-"all-clients"}_{date}.csv`
matching the spec's "שם הקובץ כולל client/report/date." Adding XLSX is a documented,
deliberate deferral - not a silent gap - for a future phase if Ariel asks for it,
rather than adding a new dependency for a "recommended" (not required) feature during
Phase 5.

### 12.6 What Phase 5 does not include

- `ReportSchedule` / scheduled email delivery of reports (spec section 15) - Phase 6.
- Client-facing reports and the Client Portal (spec sections 13, 14.1) - Phase 6,
  gated on the not-yet-added `report.client.view` permission.
- XLSX/PDF export (12.5 above) - deferred, spec marks both "recommended," not required.
- A literal 2D pivot-grid UI for "Employee x Client Matrix" - implemented as a flat,
  sortable table instead (12.3 above), consistent with every other report's table shape.


## 13. Addendum: Phase 6 (Client portal + scheduled reports)

### 13.1 Schema

Two new models plus two small additions to existing ones, all additive (no column
drops, no renames):

- **`ReportSchedule`**: one row per recurring email report a client is subscribed to.
  `clientId`, `reportType` (`ClientReportType`: `MONTHLY_DETAILED` | `WEEKLY_ACTIVITY` |
  `HOURS_BY_CATEGORY` | `HOUR_BANK_STATUS` - the four rows of spec 14.1's table that
  make sense as a recurring push; `Trend` is spec-marked "אופציונלי MVP+" and is not
  built), `frequency` (`ReportFrequency`: `WEEKLY` | `MONTHLY`, spec section 15's two
  named cadences), `recipients` (string array of emails, matching the Phase 4
  `AlertRule.recipients` precedent), `timezone` (default `Asia/Jerusalem`, spec 15:
  "כל Schedule שומר timezone"), `dayOfWeek`/`dayOfMonth`/`hour` (the schedule's stated
  cadence - see 13.2 on why `hour` is not fully load-bearing yet), `enabled`, and
  `lastSentAt`.
- **`ReportRun`**: one row per report actually sent, `@@unique([scheduleId,
  periodStart])` so the cron can never double-send the same period even if it's
  retried or overlaps - this is the literal implementation of spec 15's "לפני שליחה
  ליצור Snapshot/Report run id כדי שיהיה ניתן לדעת בדיוק מה נשלח." `snapshotJson`
  stores the actual data that was sent (the "Snapshot" spec 15 names explicitly), so a
  later dispute about what a client was shown can be answered from the `ReportRun`
  itself rather than by re-running the report against today's (possibly since-edited)
  data.
- **`Client.portalShowEmployeeNames`** (`Boolean`, default `true`): spec 13's "Weekly
  activity: ... עובדים לפי הגדרת privacy" and spec 14.1's "employee name configurable"
  both name a per-client toggle without specifying a default. Default-true is a
  deliberate choice for maximum transparency out of the box; Ankora can flip it off
  per client if a specific contract requires anonymizing which employee did the work.
- **`EmailDelivery.reportRunId`** (nullable, `onDelete: SetNull`): links a Phase 4
  `EmailDelivery` log row to the `ReportRun` it delivered, reusing the existing email
  logging/retry infrastructure (spec 15: "Email logs + retry") instead of building a
  parallel one for report emails.

### 13.2 Permission: `report.client.view`

Named explicitly in spec 4.1's own permission list, alongside `report.internal.view`
(Phase 5): "report.internal.view, report.client.view." Granted only to `CLIENT_USER`
(both `ClientUserRole.ADMIN` and `ClientUserRole.VIEWER` get it - the role split
governs recipient-management, not report *viewing*, see 13.4). `SUPER_ADMIN` and
`ANKORA_ADMIN` do not need it: they already see the same underlying data, and more,
through `report.internal.view`; granting them `report.client.view` too would just be a
second permission gating the same admin's access to a client-scoped view they can
already reach.

### 13.3 Client Portal isolation: `resolvePortalClient` as the sole entry point

Spec 21.2's integration-test requirement is explicit: "Client user של לקוח X לא יכול
לשנות URL/ID ולקבל נתוני Y." Rather than relying on every portal function to
individually re-check a caller-supplied `clientId` against the caller's own
membership (a pattern that only needs one missed check, in one function, to leak data),
`resolvePortalClient(actor)` in `lib/app-domain/client-portal.ts` is the **only**
function in the file that touches the `ClientUser` table, and every other exported
function (`getPortalDashboard`, `getWeeklyActivity`, `getMonthlyDetailed`,
`getCategorySummary`, `getPortalHistory`) calls it first and uses the `clientId` it
returns - none of them accept a `clientId` parameter from their own caller. Cross-client
leakage is therefore structurally impossible for these functions, not merely
prevented by discipline. This assumes one active `ClientUser` membership per user is
the common case for the MVP; `resolvePortalClient` takes the first membership row if a
user somehow has more than one (not currently reachable via any admin screen), which
is a documented simplification rather than a modeled multi-client-per-user portal
experience.

### 13.4 Client-facing exclusions, enforced structurally

Spec 13's own exclusion line: "אין גישה ל-Audit revisions, internal notes, actual time
אם policy אומר להציג billable בלבד, או ללקוחות אחרים." Implemented the same way as
13.3 - by construction, not by filtering after the fact:

- `fetchPortalEntries()` (the one query every portal screen's rows flow through) never
  selects `TimeEntry.note` (spec 6.1's internal free-text field) and never selects
  `actualSeconds` - only `billableSeconds`, matching spec 25's stated basis for client
  reports ("Client report basis: Billable time").
- The client-visible "activity" description is `Task.title ?? Category.name`, never
  the entry's own note - satisfying spec 13's "משימות שבוצעו" / spec 14.1's "משימה"
  column with the field that's actually meant to be shown to a client.
  `TimeEntryRevision` and `AuditEvent` are never joined anywhere in this file.

### 13.5 Report cadence vs. Vercel Hobby-plan cron limits

Spec 15 lets a schedule store an `hour` alongside `dayOfWeek`/`dayOfMonth`, implying
per-schedule send-time control. Before wiring the cron, I checked Vercel's actual
current plan limits (Hobby plan, correct as of this build): cron jobs are capped at a
minimum **once-per-day** cadence - any more frequent expression fails at deploy time -
though the per-project cron *count* was separately raised to 100. Given that
constraint, `isScheduleDue()` checks only `dayOfWeek`/`dayOfMonth` (never `hour`), and
`vercel.json` adds a single new daily cron (`/api/cron/scheduled-reports`, `"0 6 * *
*"`) alongside Phase 4's existing alerts-reconcile cron. The `hour` field is kept on
`ReportSchedule` and in the admin form - it is a genuine, stored admin preference for
if/when finer-grained scheduling infrastructure exists - but is documented in both the
code and the `ScheduleForm.tsx` UI itself ("בפועל נשלח פעם ביום; זהו תיעוד ההעדפה
בלבד") as not currently load-bearing, rather than silently ignored without
explanation.

### 13.6 Idempotent sending and the "Send now" test path

`sendReportSchedule(schedule, period, persist)` checks for an existing `ReportRun`
(via the `@@unique([scheduleId, periodStart])` constraint, 13.1) before sending
whenever `persist=true` - the daily cron is therefore safe to re-run or retry without
ever double-sending the same period's report, directly implementing spec 15's
snapshot/report-run-id requirement (13.1). Spec 15's separate line, "אפשר Send now
מתוך Admin לצורך בדיקה," is implemented as `sendReportScheduleNow`, which calls the
same send path with `persist=false`: it sends a real email (so the admin's test send is
a real, honest preview) but deliberately skips creating a `ReportRun` and skips
advancing `lastSentAt` - a manual test send must never "consume" or fulfill an actual
scheduled period, or an admin testing the feature would silently cause that period's
real client-facing report to never go out.

### 13.7 Client Admin managing recipients: mapped onto the existing role split

Spec 13: "Client Admin יכול לנהל recipients לדוחות/alerts אם Ankora מאפשרת." The
spec's own role table (section 4) already distinguishes "Client Admin" from "Client
Viewer," and the schema already models this distinction via `ClientUserRole.ADMIN` /
`ClientUserRole.VIEWER` on `ClientUser` (built in Phase 1, unchanged here). Rather than
inventing a new, separate per-client "allow recipient editing" toggle to represent "אם
Ankora מאפשרת," this phase reads that permission as already expressed by which role
Ankora assigns a given client's portal user: assigning `ADMIN` *is* how Ankora
"allows" it. `updatePortalScheduleRecipients()` enforces `clientUserRole === "ADMIN"`
and restricts the update to schedules belonging to that admin's own client (via
`resolvePortalClient`, 13.3) - a Client Admin may only ever edit the `recipients`
array, never `reportType`/`frequency`/`enabled`, which remain an Ankora-only decision
via `report.internal.view`.

### 13.8 Screens

- `/app/portal` (Dashboard + Category summary combined) - spec 13's Dashboard
  ("בנק שעות נוכחי, נוצל, נותר, % ניצול, ימים עד סוף cycle") and Category summary
  ("hours + % of total") are shown on one screen rather than two, since both are
  small, single-glance summaries and spec 13 lists them as adjacent bullets, not as
  separate top-level nav items with their own depth of content.
- `/app/portal/weekly` - spec 13's Weekly activity, with prev/next-week navigation.
- `/app/portal/monthly` - spec 13/14.1's Monthly Detailed report, plus a CSV export
  link (`/api/portal/export`) per spec 14.4's "Export מופק server-side עם אותן
  הרשאות כמו המסך" - the export route calls the exact same `getMonthlyDetailed()`
  domain function the screen renders, so the two can never disagree, mirroring the
  Phase 5 internal-reports export's own pattern (12.3).
- `/app/portal/history` - spec 13's History ("cycles קודמים ודוחות"), combining the
  client's past `HourBank` cycles (reusing Phase 3's `listHourBanksForClient`) and its
  `ReportRun` send history in one screen.
- `AppShell`'s nav is special-cased for `CLIENT_USER`: rather than building the nav
  from `can()` permission checks like every other role (which would require adding
  portal routes to a shared admin-oriented nav-building function), `CLIENT_USER` gets
  its own short, fixed nav list at the top of `navItemsFor()` - a client user's nav
  never needs role/permission branching within itself, since every `CLIENT_USER`
  sees the same four portal screens plus the guide.
- `/app` (Overview) now redirects `CLIENT_USER` straight to `/app/portal` - a client
  user has no use for the admin/employee Overview screen Phase 1/5 built.

### 13.9 What Phase 6 does not include

- `Trend` (spec 14.1, "אופציונלי MVP+") - explicitly optional, deferred.
- PDF export for client reports (spec 14.4: "PDF לדוחות לקוח מומלץ" - recommended, not
  mandatory, same deferral logic as Phase 5's XLSX/PDF deferral, 12.5).
- A dedicated per-client "allow recipients editing" toggle separate from
  `ClientUserRole` - deliberately not built, see 13.7.
- Multi-client-per-user portal accounts - `resolvePortalClient` takes the first
  `ClientUser` membership row; supporting a user who belongs to more than one client's
  portal is not modeled by any admin screen shipped so far (13.3).
- Attachment-mode report delivery - spec 15 mentions "attachment/link mode" as a
  schedule field; this phase always sends the report inline in the email body
  (matching the existing Phase 4 alert-email pattern) rather than as a file
  attachment, since no admin UI in this or any prior phase generates a durable,
  shareable link to a specific `ReportRun` yet. Documented deferral, not a silent gap.

### 13.10 Bug found during this phase's own verification: no way to create a CLIENT_USER

Live QA prep for this phase surfaced a real gap, not a documented deferral: the
Phase 1 Users screen's invite form never listed `CLIENT_USER` as a selectable role,
and `inviteUser()` only ever wrote `UserClientAccess` rows - the table that scopes an
`ANKORA_EMPLOYEE`/`ANKORA_ADMIN`'s time-reporting access to clients - never
`ClientUser`, the table `resolvePortalClient()` (13.3) actually reads. Net effect: the
entire Client Portal built in this phase was unreachable in Production, because no
admin action existed that could ever produce a `ClientUser` membership row for a real
person. Fixed within this same phase (not deferred, since a portal nobody can be
given access to is not a shipped feature): `inviteUser()` now takes an optional
`clientUserRole` and, when `role === "CLIENT_USER"`, requires exactly one client and
creates a `ClientUser` row instead of `UserClientAccess` rows; `InviteUserForm.tsx`
now lists "לקוח (פורטל לקוח)" as a role option and swaps the multi-client checkbox
list for a single required client select + a `ClientUserRole` select when that role is
chosen. The Users guide section and its previously-accurate note that CLIENT_USER
invites weren't yet possible were both updated in the same change.

## 14. Addendum: Phase 7 (PWA/mobile polish + performance + security hardening)

Spec §23's Phase 7 line ("PWA/mobile polish + performance + security hardening") has
no single dedicated spec section of its own - unlike Phases 2-6, which each map to a
numbered section. Its substance is instead assembled from several sections written
earlier in the document: §2.2's PWA note, §11.1 (mobile UX), §16.2 (security
requirements), §20 (states/errors), §21.4 (visual QA), and the subset of §24's
pre-production checklist that is about hardening rather than the Phase 8 rollout
mechanics themselves (DB separation, no-demo-data, rollback runbook - those stay
Phase 8). This section documents which concrete line items were pulled from each,
what was found on audit, and what was built or deliberately left as-is.

### 14.1 Audit findings (before any code changed)

- No `manifest.json`/`.webmanifest`, no app icons, no `theme-color`/viewport meta
  beyond Next.js defaults. §2.2's PWA note was not yet implemented.
- No security headers configured anywhere (`next.config.mjs` had no `headers()`,
  no `vercel.json` headers block). HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
  a `Content-Security-Policy`, and `Referrer-Policy` were all absent.
- No `/api/health` endpoint and no error-tracking service wired up (§24: "Error
  tracking and health endpoint").
- No `app/error.tsx`, `app/global-error.tsx`, or `app/not-found.tsx` anywhere -
  an unhandled exception in any route would fall back to Next.js's bare default
  error screen, and a bad URL under `/app/**` would 404 with no Ankora chrome.
- Login lockout, generic-failure-message, and audit logging (§16.1/§20's forbidden-
  without-detail rule) were already built correctly in Phase 1 (`lib/app-auth/
  authenticate.ts`, `lib/app-auth/login-attempts.ts`) - no gap found there.
- `components/app/MobileNav.tsx` (Phase 1) is a hamburger-triggered dropdown, not a
  bottom tab bar. §11.1 literally asks for "Bottom navigation עם 3-5 יעדים בלבד" -
  this is the clearest, most concrete gap against a specific spec line found in this
  audit.
- The Start/Stop timer button (Phase 2, `TimerWidget.tsx`) is already full-width with
  ~52px effective height on mobile - already meets "כפתור גדול וברור" and the 44px
  touch-target rule. No change needed.
- `My Time` (Phase 2) already renders `EntryRow` components (stacked rows), not a
  raw `<table>` - already meets "אין טבלאות רחבות" for the one screen spec §11
  itself names. The three Client Portal table screens (Phase 6) already wrap their
  `<table>` in `overflow-x-auto` containers, so a wide table scrolls within its own
  bounded box rather than the page scrolling sideways - an acceptable, deliberate
  reading of "no horizontal scrolling on core screens" (§21.4) that a fully re-built
  card layout would only cosmetically improve. Left as-is; see 14.5 for the one
  exception.
- Client Portal dashboard's KPI cards (`grid-cols-2 sm:grid-cols-4`) and the Overview
  screen's cards (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) both already collapse
  to a narrow-safe column count at 320-390px - no clipping found.
- Prisma schema already carries composite indexes on the highest-volume table
  (`TimeEntry`: `[userId, startAt]`, `[clientId, startAt]`, `[categoryId, startAt]`)
  plus indexes on `AuditEvent`, `HourBank`, `AlertEvent`. Two internal-reports
  functions (`hoursByClient`, `overageAtRisk` in `lib/app-domain/reports.ts`) issue
  one `getCurrentHourBank` query per active client rather than a single aggregate
  query - a real N+1 pattern, but bounded by Ankora's actual client count (tens, not
  thousands - spec §21.5's own test-data scale is 3 clients). Documented here as a
  reviewed, accepted tradeoff rather than rewritten: forcing these into a single
  aggregate query would touch working, already-shipped Phase 5 report logic without
  a measured performance problem to justify the risk. Revisit if Ankora's client
  count grows into the hundreds.
- No rate limiting exists beyond the per-account graduated lockout already in
  `login-attempts.ts` (Phase 1) - no separate IP-based throttle. Judged sufficient
  for this deployment's traffic profile; a shared IP-based limiter is infrastructure
  the spec doesn't ask for and Vercel Hobby doesn't give a good primitive for
  (no KV/Redis provisioned) - noted as a documented gap, not silently accepted.

### 14.2 PWA (spec §2.2)

Added `app/manifest.ts` (Next.js's typed manifest route, served at `/manifest.
webmanifest`) plus `192x192` and `512x512` PNG icons generated from the existing
`public/logo-mark.png` (550x550, transparent) composited onto the brand navy
(`#1B2A3D`) background - consistent with "dark premium palette" rather than a plain
white or transparent icon tile. `theme_color`/`background_color` both set to the same
navy. Display mode `standalone`, `start_url: /app`. Per §2.2's own caveat ("אך לא
להפוך PWA לתלות קשיחה") this is additive only - no service worker, no offline asset
caching, no push notification plumbing (explicitly out of MVP per §2.2's own list).
An install banner is a browser-native behavior once the manifest and HTTPS are in
place; nothing else was built to force it.

### 14.2.1 Bug found during this phase's own live QA: manifest route swallowed by [locale]

The original approach (14.2 above, before this fix) placed a Next.js file-convention
`manifest.ts` inside `app/(product)/`, expecting Next's route-segment metadata
inheritance to scope it to that route group only. Live QA on the Preview deployment
found this didn't work as designed: a request to `/manifest.webmanifest` returned
HTTP 200 with the *marketing homepage's HTML*, not the manifest JSON - `app/[locale]`'s
dynamic segment was matching the literal path `manifest.webmanifest` as an (invalid,
silently-defaulted-to-"he") locale value and rendering the homepage, out-prioritizing
the file-convention route one level deep inside the sibling `(product)` route group.
`app/robots.ts` (the true top-level app root, not nested in a route group) was
confirmed unaffected by the same test, isolating the cause to the route-group nesting
specifically. Fixed by deleting `app/(product)/manifest.ts` entirely and replacing it
with a static `public/manifest.webmanifest` file, referenced explicitly via
`metadata.manifest` in `app/(product)/layout.tsx` - a public file is served before
app-router path matching even runs, so no route-priority conflict is possible. Content
is otherwise identical to the original file-convention version.

### 14.3 Security headers (spec §16.2)

Added a `headers()` block in `next.config.mjs` applied to all routes:
`Strict-Transport-Security` (`max-age=63072000; includeSubDomains; preload` -
Vercel already terminates TLS and forces HTTPS at the edge, so this is the
production-hardening half of "HTTPS בלבד; HSTS בפרודקשן"), `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY` (the app has no legitimate reason to be framed -
closes a clickjacking vector the spec's XSS/CSRF line implies without naming),
`Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`
disabling camera/microphone/geolocation (unused by this app). A `Content-Security-
Policy` was deliberately *not* added in this phase: Next.js's default inline
`<script>` bootstrapping and the guide's embedded screenshots would need a carefully
tuned `nonce`-based CSP to avoid breaking the app, and shipping a wrong one is worse
than shipping none - documented as a deferred, not skipped, item (see 14.6).
CSRF/XSS/SQL-injection protection itself was already structurally in place before
this phase: Next.js Server Actions carry their own origin-check CSRF protection,
Prisma parameterizes all queries (no raw SQL string interpolation anywhere in the
domain layer), and React escapes all rendered text by default - audited, not
rebuilt.

### 14.4 Health endpoint + error boundaries (spec §24)

Added `GET /api/health` - unauthenticated (a health check has to be reachable by an
external monitor with no credentials), returns `{ ok: true, db: "up" }` on a
successful `SELECT 1` against Postgres via Prisma, `503` with `db: "down"` on
failure. No secrets or stack traces in the body, matching §16.2's "production logs
לא מכילים... תוכן רגיש." No external error-tracking service (Sentry et al.) was
wired up - that requires an account/API key decision that belongs to Ariel, not a
default this engagement should silently pick; flagged as an open item in 14.6, not
built. Added `app/error.tsx` (client error boundary, Ankora-branded, "משהו השתבש" +
retry) and `app/(product)/app/not-found.tsx` (branded 404 inside the AppShell,
distinguished from the marketing site's own not-found for the public pages).

### 14.5 Mobile: bottom navigation (spec §11.1)

Replaced the header hamburger-only nav with a fixed bottom tab bar
(`components/app/BottomNav.tsx`, `md:hidden`, `pb-[env(safe-area-inset-bottom)]` for
the iPhone home-indicator safe area per §11.1's own line) that renders the same
role-filtered `items` list `AppShell.tsx` already computes. To honor "3-5 יעדים
בלבד" literally regardless of how many items a given role's full nav has (2 for a
bare employee up to 9 for `SUPER_ADMIN`), the bar always shows at most the first 4
items as direct tabs plus a 5th "עוד" (more) tab; "עוד" opens the same bottom-sheet
list the old hamburger showed (remaining items, if any, plus name/role and sign-out)
rather than duplicating that UI. Every role therefore sees between 4 and 5 bottom
tabs, never more - the two mobile-first roles named in spec §11/§13
(`ANKORA_EMPLOYEE`, `CLIENT_USER`) both fit their entire nav across the 4 direct
slots plus "עוד," so no destination is ever more than one tap away. The header
hamburger button and `MobileNav.tsx` were deleted outright - the bottom bar's
"עוד" tab is now the only entry point to that same content (name/role + sign-out,
plus any nav items beyond the first 4), re-implemented directly inside
`BottomNav.tsx` rather than importing the old component, since the trigger itself
(a bottom tab vs. a header icon button) differs enough that keeping both would mean
two divergent copies of the same sheet. `<main>` gained bottom padding (`pb-24` at
mobile widths, `md:pb-10` at desktop) so page content is never hidden behind the
fixed bar.

### 14.7 Edit-conflict detection (spec 20)

Audit found a real gap here, not just missing polish: `updateTimeEntry` (Phase 2)
always wrote against whatever the row's current state was at write time, with no
check against what the editor's form had actually loaded - two people editing the
same entry within the self-edit window would silently last-write-wins overwrite each
other (fully audited via `TimeEntryRevision`, but never surfaced to either editor).
Fixed with a minimal optimistic-concurrency check rather than a full versioning
scheme: every edit form (`EntryRow.tsx`, `AdminEntryRow.tsx`) now carries a hidden
`expectedUpdatedAt` field set to the entry's `updatedAt` at render time; both server
actions pass it through to `updateTimeEntry`, which now throws a new `ConflictError`
- before applying any change - if the row's current `updatedAt` no longer matches.
The UI's `friendlyError()` maps that to "הרשומה הזו עודכנה בינתיים... יש לרענן"
rather than the generic error, giving the editor exactly the "refresh/compare"
signal spec 20 asks for (compare-and-merge itself was judged out of scope - the
existing revision history already lets an admin see what changed). The parameter is
optional so internal callers with no "form load time" of their own (tests, other
domain functions) are unaffected - see the two new tests in
`tests/integration/time-entries.test.ts`.

### 14.8 Loading skeleton (spec 20)

Added `app/(product)/app/loading.tsx` - a single generic skeleton (Next.js's
`loading.tsx` convention) rather than a bespoke one per screen, since building
20+ hand-tuned skeletons is disproportionate to what spec 20's one-line requirement
("Loading skeletons במסכים מרכזיים") calls for. Shows automatically during
server-side data fetches on navigation.

### 14.6 Explicitly deferred (not silently dropped)

- Content-Security-Policy header (14.3) - needs a nonce strategy tuned against the
  guide's inline screenshots and Next.js's own inline bootstrap script; wrong CSP
  breaks the app instead of hardening it.
- External error-tracking/APM service (14.4) - needs an account decision from Ariel
  (Sentry vs. Vercel's own Observability product, already visible in the Vercel
  dashboard used throughout this engagement's live QA).
- IP-based rate limiting beyond the existing per-account lockout - needs Redis/KV
  infrastructure not yet provisioned.
- Service worker / offline asset caching / installable-without-network - spec §2.2
  explicitly keeps "PWA a default, not a hard dependency"; §11.1's offline rule only
  asks that a running timer survive a reconnect (already true - server-authoritative
  start time, Phase 2) and that a new timer not be startable offline "אלא אם נבנית
  אסטרטגיית sync מלאה" - no such strategy exists, so the correct behavior today is
  simply: a fully offline device gets a normal network-error state on submit (§20),
  not a silent local queue. No offline banner/detection was added in this phase
  since building one without a sync strategy behind it would invite exactly the
  false affordance §11.1 warns against.
- Full card-layout rebuild of the seven admin-only `<table>` screens (Users,
  Clients, Categories, Time Entries, Hour Banks, Reports, Audit Log) - these are
  desktop-primary admin tools per spec §12's own framing (as opposed to §11's
  employee-mobile and §13's client-mobile screens); their tables already sit inside
  `overflow-x-auto` containers so the page itself never scrolls sideways. Revisit if
  Ariel reports admins actually using these screens on phones.

## 15. Addendum: Phase 8 (Integration foundation validation + production rollout)

Spec §23's last row: "Phase 8 | Integration foundation validation + production
rollout." Unlike every prior phase, this one draws from two largely independent
parts of the spec rather than one feature area: §17 ("תשתית עתידית ל-ClickUp") for
the integration foundation half, and §24 ("Checklist לפני Production") for the
rollout half. Both are audited and addressed below.

### 15.1 Audit findings (before any code changed)

- No `IntegrationConnection`/`ExternalMapping` tables, no `/app/integrations`
  screen — expected; both were explicitly deferred to "Phase 8" in Phase 2's own
  schema comments (spec §5's own field lists for them were never modeled until
  now).
- `Task.source`/`Task.externalRef` (Phase 2) already exist — the one piece of
  §17's foundation that was pre-built on purpose, per that phase's own comment.
- **Real bug, not a gap**: `lib/app-domain/reports.ts`, `client-portal.ts`, and
  `report-schedules.ts` all grouped/labeled time entries by
  `startAt.toISOString().slice(0, 10)` — a UTC calendar date — instead of the
  entry's Asia/Jerusalem calendar date. Israel is ahead of UTC (+2/+3), so any
  entry logged in the roughly two-to-three-hour window after UTC midnight but
  before Israel midnight displayed under the wrong (previous) day in: the
  internal "Manual Edits" report, the Client Portal's Weekly/Monthly activity
  rows, and scheduled report emails. The correct pattern already existed
  elsewhere in the codebase (`localDateKey` in `time-entries.ts`, an inline
  equivalent in `billing.ts`'s PER_DAY billing-policy grouping) — it just hadn't
  been reused in the three files that needed it. Billed amounts were **not**
  affected (billing.ts's grouping was already correct); only display/report
  date labels were wrong. See §15.3.
- **Second and third instances of the same bug class, one level up**:
  `report-schedules.ts`'s `computeReportingPeriod` computed the WEEKLY/MONTHLY
  reporting period's start/end boundaries from `now`'s **UTC** calendar fields
  (`getUTCDay()`, `getUTCMonth()`), while the sibling function right above it,
  `isScheduleDue`, already correctly reads `now`'s **local** weekday/day-of-month
  via `Intl.DateTimeFormat` to decide whether to fire today. So the schedule
  fired based on Israel's calendar but reported on a period computed in UTC's
  calendar — normally invisible, but disagreeing near a week/month boundary.
  The exact same pattern was independently present in `client-portal.ts`'s own
  `startOfWeek`/`endOfWeek`/`startOfMonth`/`endOfMonth` (Phase 6) — the Client
  Portal's live Weekly Activity / Monthly Detailed screens, not just the
  scheduled-email copy — meaning a client or Ankora user opening the portal
  right near a week/month boundary could see the wrong period's data under
  "this week"/"this month." All three are fixed alongside the row-level bug
  (§15.3) since they share the same root cause.
- No privacy/terms link on `/app/login` (spec §24: "Privacy links/terms in
  login/footer as needed") — the marketing site has real `/he/privacy` and
  `/he/terms` pages (built long before this time-tracking app existed); the app
  login screen simply never linked to them.
- No rollback documentation (spec §24: "Deployment rollback documented") —
  Vercel's own promote-previous-deployment mechanism already covers this; it
  was just never written down.
- This document's own header still read "Status: Proposed (pending DB provider
  confirmation)" and §4's DB-provider row still said "Open — needs your
  decision" — both were true in Phase 0, both have been false since Phase 0
  actually shipped (Vercel Postgres, Neon-backed, has been Production's database
  for seven phases). Stale documentation, not a code bug, but exactly the kind
  of drift this ADR's own "document decisions" mandate exists to prevent —
  corrected in §4 and this document's header.
- CSV Hebrew/BOM (spec §24), audit log, alert dedupe, hour-bank rollover,
  health endpoint, mobile responsive QA: all already verified correct in
  Phases 1-7 (own dedicated tests/live QA each cited in their respective
  addenda above) — re-confirmed by re-reading rather than re-tested from
  scratch, since nothing in Phase 8 touches that code.

### 15.2 Integration foundation (spec §5, §17)

`IntegrationConnection` (provider, status, credentialsRef, config) and
`ExternalMapping` (provider, internal/external entity type+id, syncMetadata) are
modeled exactly as spec §5 lists them — no extra columns invented. `credentialsRef`
is a `String?` pointer, never a credential value (§17.2: "Credentials נשמרים
secret/encrypted store, לא בטבלת plain text") — nothing in this phase ever writes a
real value into it, because no OAuth flow exists yet.

`lib/app-domain/integrations.ts` defines `IntegrationProvider`, §17.1's own
interface list verbatim (`connect`, `disconnect`, `pullTasks`, `pushTimeEntry`,
`handleWebhook`, `healthCheck`), and one concrete implementation:
`clickUpPlaceholder`, whose every mutating method rejects with an explicit "not
implemented yet" reason and whose `healthCheck` alone succeeds (reporting
`not_connected`). This is deliberate, not a stub to fill in casually later — §17.3
is explicit that Ankora should not request OAuth scopes until the real
integration is built, so a provider that quietly did nothing on `connect()` would
be worse than one that says so.

`/app/integrations` (spec §12's admin screens table, its final row) renders one
card per known provider from `listIntegrationConnections` (SUPER_ADMIN-only via
the new `integration.manage` permission — same SUPER_ADMIN-only precedent as
`hour_bank.manage`/`alert.manage`, since connecting an external system's
credentials is exactly the "critical system action" spec §4's Ankora Admin/Manager
row says it does not get unless explicitly granted). No "Connect" button exists
yet — showing a real one before OAuth exists would invite exactly the false
affordance spec §17.3 warns against, the same reasoning Phase 7's PWA addendum
(§14.6) already applied to the offline-banner question.

### 15.3 Timezone fix (spec §24: "Timezone tests around midnight/month boundary")

`lib/timezone.ts` is a new shared module, extracting what was previously a
private `localDateKey` helper in `time-entries.ts` plus a duplicated inline
`Intl.DateTimeFormat` call in `billing.ts`. It exports:

- `localDateKey(date, timeZone = "Asia/Jerusalem")` — the one correct way to ask
  "which calendar day is this UTC instant, locally."
- `localDateTimeToUtc(dateStr, timeStr, timeZone)` — generalized from
  `time-entries.ts`'s `combineWallClockTime` (which now just calls this fixed to
  its own constant), converting a local wall-clock date+time into the correct UTC
  instant.

`reports.ts`, `client-portal.ts`, and both `report-schedules.ts` row-mappers now
call `localDateKey(e.startAt)` instead of `e.startAt.toISOString().slice(0, 10)`.
`billing.ts`'s inline call was replaced with the shared helper for consistency
(no behavior change there — it was already correct).

`computeReportingPeriod` now takes the schedule's own `timezone` (both call
sites pass `schedule.timezone`, not a hardcoded default), reads `now`'s local
Y-M-D via `localDateKey`, does the week/month rollover arithmetic on those plain
numbers (weekday-of-a-date and month-overflow are timezone-free calendar facts
once you have Y-M-D — `Date.UTC`'s own overflow normalization handles month/day
wraparound correctly), then converts the resulting local boundary back to a real
UTC instant via `localDateTimeToUtc` for the Prisma range query. The email
subject's period label was similarly fixed to format via `localDateKey` instead
of `toISOString()`, computing the inclusive last day from local Y-M-D numbers
rather than subtracting a fixed 24 hours (which would land on the wrong
wall-clock time across a DST-transition night).

`client-portal.ts`'s `startOfWeek`/`endOfWeek`/`startOfMonth`/`endOfMonth` were
fixed the identical way: each now derives its local Y-M-D via `localDateKey`,
does the same tz-free calendar arithmetic, and converts back via
`localDateTimeToUtc`. `getWeeklyActivity`/`getMonthlyDetailed` (the Client
Portal's own live screens) needed no changes beyond that — they already called
these four helpers rather than doing their own date math.

No test previously exercised a near-midnight or month-boundary entry, which is
exactly why this shipped unnoticed across Phases 5-6 — new regression tests
(§15.5) now pin both the row-grouping and the period-computation behavior at
Israel's actual UTC+2/+3 boundary.

### 15.4 Production checklist walkthrough (spec §24)

| Item | Status |
|---|---|
| Production DB separate from dev/staging | ✅ Neon branching — Preview gets its own DB branch per deployment, Production is its own branch, local dev uses `embedded-postgres`. |
| Backups + restore test | ⚠️ Neon takes continuous backups automatically (platform-level, not app code) — but an actual **restore drill** is an operational exercise against Ariel's own Neon project console, not something this engagement can perform from the sandbox (standing rule: never touch Production's `DATABASE_URL` directly). Flagged for Ariel to schedule once. |
| HTTPS + secrets + auth security | ✅ Vercel enforces HTTPS; secrets live in Vercel env vars (Production/Preview separated); Auth.js + bcrypt + rate-limited login (Phase 1), security headers (Phase 7). |
| Admin account recovery | ✅ `PasswordResetToken` flow (Phase 1) works for every role including SUPER_ADMIN — not portal-only. |
| No demo users/data in Production | ✅ `prisma/seed.ts` is dev/Preview-only by convention (never run against `DATABASE_URL` pointed at Production); every seeded row is named `demo.*`/marked DEMO per spec §0/§21.5. |
| Client isolation E2E passed | ✅ `tests/integration/rbac-and-client-isolation.test.ts` (Phase 1) plus every phase's own isolation tests since (Client Portal's `resolvePortalClient`, spec 21.2's specific scenarios). |
| Audit log tested | ✅ `/app/audit-log` (Phase 1) + `AuditEvent` writes verified in every phase's own integration tests. |
| Email domain/provider configured + SPF/DKIM | ✅ Resend + `ankora.co.il`, domain-verified since Phase 4 (domain verification in Resend requires SPF/DKIM DNS records to already be correct) — real end-to-end delivery tested in Phase 4's own live QA. |
| Alert dedupe tested | ✅ `dedupe_key` + `tests/unit/alerts.test.ts` (Phase 4). |
| Timezone tests around midnight/month boundary | ✅ Was the gap this phase found and fixed — see §15.3/§15.5. |
| Hour bank opening balances verified | ✅ `openHourBankCycle` + rollover tests (Phase 3). |
| Privacy links/terms in login/footer | ✅ Fixed this phase — `/app/login` now links `/he/privacy` and `/he/terms`. |
| Error tracking and health endpoint | ⚠️ `/api/health` done (Phase 7). External error-tracking vendor (Sentry vs. Vercel Observability) still needs Ariel's account decision — carried over from Phase 7's own §14.6, unchanged. |
| Mobile Safari/Android Chrome passed | ⚠️ Verified via Chrome device emulation across every phase's live QA (most recently Phase 7's real mobile-viewport bottom-nav check) — this sandbox has no access to a real iOS device/Safari, so genuine Safari verification is best-effort via emulation, not a real-device pass. Flagged for Ariel to spot-check on an actual iPhone once convenient. |
| CSV Hebrew opens correctly | ✅ `lib/csv.ts`'s UTF-8 BOM prefix (Phase 5), `tests/unit/csv.test.ts`. |
| Performance test on realistic data | ✅ Phase 7 (§14, performance pass). |
| Deployment rollback documented | ✅ Fixed this phase — new README section. |

Three items are marked ⚠️ rather than ✅: a Neon restore drill, the external
error-tracking vendor decision, and a real-device Safari pass. All three require
either Ariel's own account/vendor decision or an action outside what this
sandboxed engagement can perform (touching Production's actual database, or a
physical iOS device) — consistent with how Phase 7's error-tracking gap was
already handled, they are reported transparently rather than silently marked
done.

### 15.5 Tests

`tests/unit/timezone.test.ts` (new): `localDateKey` at the Israel UTC+2/+3
boundary (a `startAt` just after UTC midnight but before Israel midnight, both in
winter and summer/DST), and at a year boundary (Dec 31 UTC late evening = Jan 1
Israel). `computeReportingPeriod` at a month boundary where UTC and Israel
calendars would disagree. `tests/unit/integrations.test.ts` (new):
`clickUpPlaceholder`'s every mutating method rejects without throwing;
`healthCheck` reports `not_connected`. `tests/integration/reports.test.ts` /
`client-portal.test.ts` gain one regression case each: a `TimeEntry` seeded with
`startAt` in the UTC/Israel disagreement window now asserts the row's `date`
field is the correct Israel-local day, not the UTC day. `tests/unit/
permissions.test.ts` gains `integration.manage` to its SUPER_ADMIN-only
regression guard, matching the existing pattern for `hour_bank.manage`/
`alert.manage`.

## 16. Addendum: Delivery-package closeout (spec §26 Definition of Ready)

### 16.1 Context

Spec §23's phase table (Phase 0 through Phase 8) is now fully implemented and
shipped to Production — Phase 8's PR (#9) merged and verified live. The spec
defines no Phase 9; §23's own development order ends at Phase 8
("Integration foundation validation + production rollout"). Rather than
inventing further phases the spec never asked for, this addendum documents an
audit against spec §26 ("Definition of Ready למסירת האפליקציה"), which lists
the concrete deliverables a complete handoff requires:

> קלוד מספק: קוד נקי ומתועד, migrations, README להתקנה/Deployment,
> env.example ללא secrets, תרשים schema/ERD, פירוט roles/permissions, seed
> script ל-Staging, test suite, רשימת known limitations, ו-Admin guide קצר
> להפעלת לקוח חדש והגדרת בנק שעות/alerts/reports.

### 16.2 Audit findings

Most of §26's list has existed and been kept current since early phases:
clean/documented code (every model and permission in `schema.prisma`/
`permissions.ts` carries an inline rationale comment, a practice followed
since Phase 1), hand-authored migrations for every phase, a README with
install/local-setup/deployment instructions (extended each phase), a secret-
free `.env.example`, `prisma/seed.ts`'s demo fixtures, and a 22-file Vitest
suite (unit + integration) across every domain module. The in-app Hebrew
guide (`/app/guide`, built in the guide phase and required by this project's
own standing rule — ADR §10 — to stay current on every capability change)
satisfies "Admin guide קצר" and then some: it is more thorough than a static
doc, with real screenshots per role, and was already kept in sync through
Phase 8.

Two items were genuinely missing, and one was stale:

1. **No ERD/schema diagram existed.** The schema's own rationale lives in
   `schema.prisma`'s inline comments, but nothing renders the 20-model
   structure visually. Added `docs/erd.md` (Mermaid `erDiagram`), grouped by
   the phase that introduced each model, matching `schema.prisma`'s own
   section comments so the two documents stay easy to cross-reference.

2. **No standalone roles/permissions matrix existed.** README's "Roles &
   permissions" section (written Phase 1, lightly extended since) is prose,
   not a matrix, and doesn't mention `report.client.view` (Phase 6) or
   `integration.manage` (Phase 8) at all. Added `docs/roles-permissions.md`:
   a full role × permission table generated directly from `ROLE_PERMISSIONS`
   in `lib/app-auth/permissions.ts`, with a one-line note on each permission's
   origin phase so it can be diffed against the source map by eye. This does
   not replace the README's prose explanation (which carries the *why* behind
   each grant/withhold decision, e.g. `report.internal.view` going to
   `ANKORA_ADMIN` while `hour_bank.manage` does not) — it is a
   quick-reference companion, and the README's "Roles & permissions" section
   now links to it.

3. **README's "Known limitations" section was stale.** Still titled "(Phase
   1, by design)" and listing gaps that Phases 2–7 already closed (no timer/
   billing existed at the time it was written; both now do). Rewritten to
   describe the application's actual current limitations as of Phase 8 —
   see §16.3.

### 16.3 Known limitations, reviewed as of Phase 8

The rewritten README section reflects what is genuinely still a limitation
today, not what was true in Phase 1:

- No real external integration is connected yet — `/app/integrations`
  (Phase 8) shows ClickUp as a deliberate placeholder; every mutating method
  on its provider adapter rejects by design (spec §17.3: no OAuth scope
  requested until the integration is actually built).
- Forecast-based hour-bank alerts and anomaly detection are spec §28 "future"
  ideas, explicitly out of scope for all of Phase 0–8 (not a bug, a
  documented non-goal).
- The three §24 checklist items already flagged ⚠️ in §15.4 (Neon restore
  drill, external error-tracking vendor choice, real-device Safari pass)
  remain open pending Ariel's own action — repeated here rather than
  duplicated with different wording, since they are the same three items.
- Audit log has no export/retention policy UI (unchanged since Phase 1 — an
  append-only table with a read-only filtered viewer; retention/export was
  never a stated acceptance criterion for any phase).

### 16.4 Non-goals of this closeout

This is a documentation pass, not a new phase: no schema change, no new
permission, no new screen, and therefore no in-app guide update is triggered
(ADR §10's standing rule applies to capability changes; two new reference
documents and a stale-section rewrite are not one). Local verification
(tsc/eslint/vitest) still runs and is compared against `main` before pushing,
per this engagement's standing discipline for every substantive repository
change, documentation included.

## 17. Full spec re-audit (post-delivery, Ariel-requested)

### 17.1 Context

After the §26 delivery package closed out (section 16), Ariel asked for a
fresh line-by-line re-read of the entire spec (`Ankora_Time_Tracking_Product_
Spec_HE.docx`, sections 0–29 — not just §26) against the shipped app, to
surface anything genuinely missed before deciding what, if anything, to do
about it. This section records that audit's findings. No code changed as
part of this section — Ariel asked to be shown the gaps first.

### 17.2 Confirmed gaps

- **`Task.status` doesn't exist.** Spec §5's data model and §10.2 both
  specify Open/In progress/Done/Archived on `Task`. The current `Task`
  model (`prisma/schema.prisma`) has no status field at all — every task is
  implicitly "open" forever. This also means the spec §11 "Tasks" screen
  (see below) has nothing meaningful to filter by status even if built.
- **No standalone "Tasks" screen.** Spec §11's screen table lists a
  dedicated employee-facing screen — open/recent tasks, filterable by
  client/category/status. Today a `Task` only exists as an inline
  create-or-pick autocomplete inside the timer and manual-entry forms;
  there is no screen that lists tasks on their own.
- **No "Profile" screen.** Spec §11 calls for a self-service in-app screen
  for timezone/password/preferences while logged in. What exists today is
  the unauthenticated forgot-password → reset-password flow only; there is
  no page for a logged-in user to change their own password or set a
  timezone preference.
- **No "Notifications" screen.** Spec §11 calls for an in-app view of
  anomalies/long-timer warnings/internal alerts. No such screen or
  persisted notification list exists anywhere in the app.
- **Long-running-timer notification is incomplete.** Spec §6.1 requires
  both a UI warning *and* an email/internal notification to the user once a
  timer exceeds a configurable threshold. Only the first half is built —
  `TimerWidget.tsx` shows an amber "הטיימר רץ זמן ארוך" badge past 8 hours,
  but no email is sent and nothing is persisted, so the warning disappears
  the moment the user isn't looking at the timer screen (and has nowhere to
  see it later, per the missing Notifications screen above).
- **XLSX/PDF export not built.** Spec §14.4 marks these "מומלץ"
  (recommended, not mandatory) with CSV as the only hard requirement — CSV
  is implemented correctly, including the UTF-8 BOM Hebrew-in-Excel
  requirement (`lib/csv.ts`). XLSX and PDF were never built. This was not
  previously called out by name in the README's Known Limitations section.

### 17.3 Checked and confirmed NOT gaps

For completeness, since Ariel asked for a real audit and not just a list of
suspicions: recent/favorite client+category combos on the timer (§6.2),
mandatory reason for back-dated manual entries (§6.3), the 48-hour
self-edit window before a Manager permission is required (§6.4), optimistic
concurrency / "don't overwrite a concurrently-edited entry" (§20), URL-
persisted report/entry/audit-log filters (§14.3), the password policy
(10-char minimum + common-weak-password rejection, §4.2), login
success/failure audit events (§16.1), the internal 9-report set matching
§14.2's table exactly, the client 4-report set matching §14.1 minus the
spec-marked-optional Trend report, and a dedicated client-isolation
integration test suite (§16.2/§21.2) all exist and match the spec.

### 17.4 Non-goals of this audit

This section is a findings record only. Whether to build any of §17.2's
five gaps, and in what order, is Ariel's call — flagged to him directly
rather than assumed. No schema, permission, or screen changed, so no
in-app guide update is triggered here either.
