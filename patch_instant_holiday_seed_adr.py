#!/usr/bin/env python3
"""
ADR addendum: instant holiday seeding on subscribe.

Appends a short section documenting the change made by
patch_instant_holiday_seed.py, following the same append-with-marker
pattern as patch_adr_holiday_verification_v2.py (anchor-matching a
specific old tail failed once before over a whitespace mismatch;
appending sidesteps that).

Run from the repo root (arielankora/ankora-website), same branch as
patch_instant_holiday_seed.py (feat/instant-holiday-seed).
Idempotent: safe to re-run.
"""
import pathlib

ROOT = pathlib.Path(".")
ADR_PATH = ROOT / "docs/adr/0001-time-tracking-app-architecture.md"

NEW_SECTION = '''

### 21.15 Instant holiday seeding on subscribe (Ariel follow-up request)

Previously, subscribing a client to a holiday calendar
(`setHolidayCalendarSubscription()`) only created the
`HolidayCalendarSubscription` row - the actual `ImportantDate` rows for
each holiday were materialized by `seedHolidayOccurrences()`, which only
ran as step 1 of the daily cron (`reconcileImportantDates()`, 05:00 UTC).
A user subscribing a client mid-day would see nothing until the next
day's run.

Ariel asked whether subscribing could trigger the seed immediately
instead. `seedHolidayOccurrences()` was already idempotent and safe to
call twice - its create path is protected by the real guarantee, the
`ImportantDate` `@@unique([clientId, holidayKey])` constraint, not just
an in-memory check - so calling it a second time, immediately, carries
no duplication risk.

Implementation: `seedHolidayOccurrences()` gained an optional `scope:
{ clientId?, calendarKey? }` param. The daily cron's own call stays
unscoped (full sweep, unchanged). `setHolidayCalendarSubscription()`
now calls the scoped version right after enabling a subscription, so
only that one (client, calendar) pair is processed - subscribing one
client never re-sweeps every other client's subscriptions. Disabling a
subscription never seeds (no behavior change there). The call is
wrapped in a try/catch that only logs: a transient failure here must
never fail the subscription action itself or leave the subscription
row in an inconsistent state, since the daily cron remains the
authoritative, retried backstop for this exact same work either way.

Guide (`guide/content.ts`) updated to say the holiday date is created
"מיד, ללא צורך להמתין לבדיקה היומית" (immediately, no need to wait for
the daily check) instead of leaving the timing unstated.

Tests (`tests/integration/important-dates.test.ts`): the existing
idempotency test was rewritten to assert the new behavior directly
(subscribing alone now produces the `ImportantDate` rows, no separate
`seedHolidayOccurrences()` call needed to see them; a subsequent sweep
still produces zero new rows). A new test asserts the `scope` param
never leaks into an unrelated client's subscription - inserting two
enabled subscriptions for two different clients and confirming a scoped
call only seeds the targeted one.

**Status:** on branch `feat/instant-holiday-seed`, not yet pushed by
Ariel at the time this section was written. Not yet merged - merge
requires Ariel's explicit approval per this ADR's standing rule.
'''

text = ADR_PATH.read_text(encoding="utf-8")

if "### 21.15" in text:
    print("Already applied: section 21.15 is already present. No changes written.")
else:
    ADR_PATH.write_text(text.rstrip("\n") + "\n" + NEW_SECTION.lstrip("\n") + "\n", encoding="utf-8")
    print(f"Patched (appended): {ADR_PATH}")

print("\nDone.")
