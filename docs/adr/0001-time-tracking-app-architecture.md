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
