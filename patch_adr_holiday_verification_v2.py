#!/usr/bin/env python3
"""
Phase 10 follow-up: ADR addendum documenting the holiday-calendar
subscription UI and the results of live verification (sensitivity/notes
redaction, daily cron review).

v2: appends to the end of docs/adr/0001-time-tracking-app-architecture.md
instead of anchor-matching a specific old tail string (v1 failed: the
anchor text - reconstructed by hand from a browser-rendered copy of the
file - didn't byte-for-byte match the real file's dashes/whitespace, so
it aborted with 0 matches and wrote nothing). Appending to file-end
sidesteps that entirely. Idempotent: skips if section 21.14 is already
present.

Run from the repo root (arielankora/ankora-website), on the
feature/important-dates-holiday-subscriptions branch.
"""
import pathlib

ROOT = pathlib.Path(".")
ADR_PATH = ROOT / "docs/adr/0001-time-tracking-app-architecture.md"

NEW_SECTION = '''

### 21.14 Follow-up: holiday-calendar subscription UI + live verification (this round)

Two items from the section 21 gap list (as reported to Ariel after the
initial Preview QA pass - 21.10's UI-scope note and 21.9's "not yet
executed" caveat) were closed out in this round, at Ariel's explicit
instruction ("section 1 and section 4" of that gap list).

**Section 1 - holiday-calendar subscription UI.** The four pre-loaded
holiday catalogs (Israel, international, US, UK - see 21.6/21.7) had no
UI path to actually subscribe a client to one; `setHolidayCalendarSubscription()`
was callable only from a script. Added a minimal enable/disable panel
("לוחות חגים") to the client-detail screen, gated behind
`important_date.manage_catalog` (SUPER_ADMIN-only, matching the
function's own check), listing each catalog with its holiday count and
a toggle. Deliberately does not expose per-calendar lead-days/
responsible-user/auto-task overrides in this round - `setHolidayCalendarSubscription()`'s
own defaults (30/7-day reminders, no auto-task) apply on first
subscribe; a follow-up round can add that customization UI. Implementation:
`HolidayCalendarsPanel.tsx` (new client component, reusing
`alerts/RuleActions.tsx`'s call-a-server-action-via-useTransition
pattern) + `toggleHolidayCalendarSubscriptionAction` in
`important-dates/actions.ts` + wiring in `clients/[clientId]/page.tsx`.
Guide (`guide/content.ts`) updated with the new step and a rewritten
note describing the four catalogs and where to subscribe.

**Real bug found and fixed (this round):** the first patch imported
`HolidayCalendarsPanel` from `"./HolidayCalendarsPanel"` in
`clients/[clientId]/page.tsx`, but the component file lives one
directory up (`clients/HolidayCalendarsPanel.tsx`, a sibling of the
`[clientId]` folder, not inside it). Real Vercel build failed:
`Module not found: Can't resolve './HolidayCalendarsPanel'`. This is a
directory-structure/module-resolution error, not a text-matching error,
so it was invisible to the patch script's own anchor-count check and
only surfaced on a real build - same category of gap as 21.12's
`server-only` bug, and the same reason a real `next build` stays part of
this checklist. Fixed with a one-line import-path correction
(`"../HolidayCalendarsPanel"`); the resulting deployment reached Ready.

A second, unrelated infra issue blocked the first Preview build before
the code fix could even be tested: the Neon project's free-tier branch
quota (10/10) was exhausted by stale merged-preview branches
accumulated across the engagement. Diagnosed via Vercel's deployment
error + Neon Console, fixed by deleting one stale branch
(`preview/docs/guide-reorder-cleanup`) to free headroom. Not a code
regression.

**Section 4 - verification gaps closed:**

- **Month-grouped view + holiday-subscription flow**: live-QA'd on the
  Preview deployment as `demo.superadmin@ankora.co.il` - the month-
  grouped list view (21.10's disclosed scope reduction, still not a
  day-grid calendar) renders correctly, and subscribing demo-client-a to
  a holiday calendar via the new panel correctly shows "רשום" and
  persists.
- **Sensitivity/notes redaction, end-to-end - CONFIRMED WORKING.** Created a
  HEALTH_TRAVEL-category ImportantDate (auto-defaulted to SENSITIVE per
  21.x's category default), responsible user `demo.admin@ankora.co.il`,
  with a notes field. Confirmed as `demo.superadmin@ankora.co.il` (an
  admin - `canViewSensitiveDetails()` always returns true for
  `canManageClients(role)`) that the notes text is fully visible. Then
  logged in as `demo.employee1@ankora.co.il` - who has client access to
  demo-client-a but is neither the date's responsible user nor an
  admin/super-admin - and confirmed the entire "הערות" (notes) section
  is absent from the rendered detail page (not blanked, not a redacted
  placeholder - the field and its heading simply do not render), while
  every other field (title, category, status, reminders, next
  occurrence) remains visible. This matches `getImportantDate()`'s
  `canViewSensitiveDetails()` gate exactly (`lib/app-domain/important-dates.ts`).
  Also observed, and confirmed intentional (not a bug): the same
  non-admin employee can still change the date's status, snooze, and
  soft-delete it. This is not an oversight - per this module's own
  documented design (`important-dates.ts`'s file-header comment),
  "can this user act on this ImportantDate" is scoped to client access
  only (the same precedent as `tasks.ts`), with sensitivity gating
  *field visibility* (notes), not *action* permissions. Flagged here
  explicitly so it's a disclosed design choice, not a silent gap.
- **Daily cron (`reconcileImportantDates`), end-to-end - partially
  verified, with a real limitation disclosed.** Confirmed structurally:
  `vercel.json` registers `/api/cron/alerts-reconcile` at `0 5 * * *`
  (05:00 UTC daily), Vercel's Cron Jobs dashboard shows it Enabled with
  the correct path/schedule, and the route correctly rejects any request
  without `Authorization: Bearer ${CRON_SECRET}` (so it can't be
  triggered by an outside caller). Code-reviewed `important-dates-job.ts`'s
  full 7-step `reconcileImportantDates()` (holiday seeding, occurrence
  rollover, overdue flagging, reminder creation/sending, auto-tasks,
  escalation) against its own design doc (21.x) - each step is
  independently try/caught (one bad row never aborts the run, matching
  `reconcileAllClientAlerts()`'s isolation precedent) and each write
  path is idempotency-key- or unique-constraint-protected against
  double-firing on overlapping runs. What was **not** independently
  confirmed this round: an actual live invocation of the cron and
  inspection of its real JSON result. Vercel Cron only ever fires
  against Production (never Preview), this route requires
  `CRON_SECRET` (not available in this session), and manually clicking
  "Run" on Vercel's Cron Jobs dashboard would fire the real job against
  real production data - including potentially sending real reminder
  emails to real clients - which is a real-world side effect this
  session does not have standing authorization to trigger unprompted.
  Vercel's Hobby-plan log retention also did not surface a prior
  automatic firing in the query window checked. **This is disclosed as
  an open item, not silently marked done**: the safest path to a true
  live-fire confirmation is either Ariel manually running it from
  Vercel's Cron Jobs page (Production project -> Settings -> Cron Jobs
  -> Run, next to `/api/cron/alerts-reconcile`) and sharing the JSON
  response, or waiting for tomorrow's automatic 05:00 UTC firing and
  checking Vercel's logs/the resulting data the next day.

**Status:** all of the above is on branch
`feature/important-dates-holiday-subscriptions`, pushed, deployed to
Preview, and live-QA'd per this section. Not yet merged to `main` -
merge requires Ariel's explicit approval per this ADR's standing rule
(see section on approvals).
'''

text = ADR_PATH.read_text(encoding="utf-8")

if "### 21.14" in text:
    print("Already applied: section 21.14 is already present. No changes written.")
else:
    ADR_PATH.write_text(text.rstrip("\n") + "\n" + NEW_SECTION.lstrip("\n") + "\n", encoding="utf-8")
    print(f"Patched (appended): {ADR_PATH}")

print("\nDone.")
print("Next: review the diff (git diff), then, still on")
print("feature/important-dates-holiday-subscriptions:")
print('  git add -A')
print('  git commit -m "docs: ADR addendum for holiday subscription UI + verification results (v2)"')
print('  git push')
