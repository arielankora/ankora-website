#!/usr/bin/env python3
"""
Instant holiday seeding on subscribe (Ariel follow-up request): don't
make the user wait for tomorrow's 05:00 UTC cron to see the holidays
they just subscribed a client to.

seedHolidayOccurrences() (lib/app-domain/important-dates-job.ts) was
already idempotent and protected by the ImportantDate
@@unique([clientId, holidayKey]) constraint - so it's safe to call it a
second time, immediately, right after a subscription is created/enabled.

Changes:
1. lib/app-domain/important-dates-job.ts - seedHolidayOccurrences() gets
   an optional `scope: { clientId?, calendarKey? }` param so an instant
   call only processes the one subscription that was just enabled,
   instead of re-sweeping every client's subscriptions. The daily cron's
   own call stays unscoped (full sweep), unchanged.
2. lib/app-domain/important-dates.ts - setHolidayCalendarSubscription()
   calls the newly-scoped seedHolidayOccurrences() right after enabling
   a subscription. Wrapped in try/catch that only logs - a transient
   failure here must never fail the subscription action itself or block
   on it; the daily cron remains the authoritative, retried backstop.
3. guide/content.ts - one-line wording update: "instantly" instead of
   implying nothing about timing.
4. tests/integration/important-dates.test.ts - updates the existing
   idempotency test to reflect that subscribing now seeds immediately
   (no separate seedHolidayOccurrences() call needed to see the rows),
   and adds a new test asserting the scope param never leaks into an
   unrelated client's subscription.

Run from the repo root (arielankora/ankora-website), on a fresh branch
off main (e.g. `git checkout -b feat/instant-holiday-seed`).
Idempotent: safe to re-run.
"""
import pathlib
import sys

ROOT = pathlib.Path(".")


def patch_file(relpath, marker, old, new, label):
    path = ROOT / relpath
    text = path.read_text(encoding="utf-8")
    if marker in text:
        print(f"[{label}] already applied - skipping.")
        return
    count = text.count(old)
    if count != 1:
        print(
            f"ABORT [{label}]: expected exactly 1 occurrence of the anchor in {relpath}, found {count}.\n"
            f"No changes were written to this file.\nAnchor (first 200 chars):\n{old[:200]!r}",
            file=sys.stderr,
        )
        sys.exit(1)
    path.write_text(text.replace(old, new), encoding="utf-8")
    print(f"[{label}] patched: {relpath}")


# ---------------------------------------------------------------------------
# 1. important-dates-job.ts - add optional scope param
# ---------------------------------------------------------------------------

JOB_OLD = '''// ---------------------------------------------------------------------------
// 1. Holiday seeding (opt-in only - spec: "לעולם לא subscribe אוטומטית
//    לכל לקוח")
// ---------------------------------------------------------------------------

export async function seedHolidayOccurrences(now = new Date()): Promise<{ created: number }> {
  const subscriptions = await prisma.holidayCalendarSubscription.findMany({ where: { enabled: true } });
  if (subscriptions.length === 0) return { created: 0 };'''

JOB_NEW = '''// ---------------------------------------------------------------------------
// 1. Holiday seeding (opt-in only - spec: "לעולם לא subscribe אוטומטית
//    לכל לקוח")
// ---------------------------------------------------------------------------

/// `scope` narrows which enabled subscriptions get processed - omitted
/// (undefined) for the daily cron's full sweep of every client, or
/// { clientId, calendarKey } for the instant, single-subscription seed
/// that setHolidayCalendarSubscription() (important-dates.ts) triggers
/// right after a client is subscribed (Ariel follow-up request: don't
/// make the user wait for tomorrow's 05:00 UTC cron to see the holidays
/// they just subscribed to). Scoping only changes which subscriptions
/// are read - the create-if-missing/dedupe logic below is identical
/// either way, so this never introduces a second code path to keep in
/// sync.
export async function seedHolidayOccurrences(
  now = new Date(),
  scope?: { clientId?: string; calendarKey?: string }
): Promise<{ created: number }> {
  const subscriptions = await prisma.holidayCalendarSubscription.findMany({
    where: {
      enabled: true,
      ...(scope?.clientId ? { clientId: scope.clientId } : {}),
      ...(scope?.calendarKey ? { calendarKey: scope.calendarKey } : {}),
    },
  });
  if (subscriptions.length === 0) return { created: 0 };'''

patch_file(
    "lib/app-domain/important-dates-job.ts",
    "scope?: { clientId?: string; calendarKey?: string }",
    JOB_OLD,
    JOB_NEW,
    "important-dates-job.ts",
)

# ---------------------------------------------------------------------------
# 2. important-dates.ts - import + call seedHolidayOccurrences on enable
# ---------------------------------------------------------------------------

DOM_IMPORT_OLD = 'import { HOLIDAY_CATALOG, HOLIDAY_CALENDAR_LABELS, type HolidayCalendarKey } from "@/lib/app-domain/important-dates-holidays";\nimport type {'
DOM_IMPORT_NEW = 'import { HOLIDAY_CATALOG, HOLIDAY_CALENDAR_LABELS, type HolidayCalendarKey } from "@/lib/app-domain/important-dates-holidays";\nimport { seedHolidayOccurrences } from "@/lib/app-domain/important-dates-job";\nimport type {'

patch_file(
    "lib/app-domain/important-dates.ts",
    'import { seedHolidayOccurrences } from "@/lib/app-domain/important-dates-job";',
    DOM_IMPORT_OLD,
    DOM_IMPORT_NEW,
    "important-dates.ts (import)",
)

DOM_FN_OLD = '''  await recordAudit({
    actorId: actor.id,
    action: "holiday_calendar_subscription.update",
    entityType: "HolidayCalendarSubscription",
    entityId: sub.id,
    clientId,
    after: sub,
  });

  return sub;
}'''

DOM_FN_NEW = '''  await recordAudit({
    actorId: actor.id,
    action: "holiday_calendar_subscription.update",
    entityType: "HolidayCalendarSubscription",
    entityId: sub.id,
    clientId,
    after: sub,
  });

  // Ariel follow-up request: don't make the user wait for tomorrow's
  // 05:00 UTC cron to see the holidays they just subscribed to - seed
  // this one (clientId, calendarKey) pair immediately. Scoped (not a
  // full seedHolidayOccurrences() sweep) so subscribing one client never
  // re-processes every other client's subscriptions too. Never runs on
  // disable (input.enabled === false - nothing to seed), and a failure
  // here is logged but never thrown back to the caller: the daily cron
  // remains the authoritative, retried backstop for this exact same
  // work, so a transient error here must not fail the subscription
  // action itself or leave `sub` in an inconsistent state.
  if (input.enabled) {
    try {
      await seedHolidayOccurrences(new Date(), { clientId, calendarKey });
    } catch (err) {
      console.error("Immediate holiday seeding failed after subscribing; the daily cron will retry.", err);
    }
  }

  return sub;
}'''

patch_file(
    "lib/app-domain/important-dates.ts",
    "Immediate holiday seeding failed after subscribing",
    DOM_FN_OLD,
    DOM_FN_NEW,
    "important-dates.ts (setHolidayCalendarSubscription)",
)

# ---------------------------------------------------------------------------
# 3. guide/content.ts - wording tweak
# ---------------------------------------------------------------------------

GUIDE_PATH = ROOT / "app/(product)/app/(authenticated)/guide/content.ts"
GUIDE_OLD = "הרשמה יוצרת אוטומטית מועד חשוב לכל חג בלוח"
GUIDE_NEW = "הרשמה יוצרת מיד, ללא צורך להמתין לבדיקה היומית, מועד חשוב לכל חג בלוח"

guide_text = GUIDE_PATH.read_text(encoding="utf-8")
if GUIDE_NEW in guide_text:
    print("[guide/content.ts] already applied - skipping.")
else:
    count = guide_text.count(GUIDE_OLD)
    if count != 1:
        print(
            f"ABORT [guide/content.ts]: expected exactly 1 occurrence, found {count}.\nNo changes written.",
            file=sys.stderr,
        )
        sys.exit(1)
    GUIDE_PATH.write_text(guide_text.replace(GUIDE_OLD, GUIDE_NEW), encoding="utf-8")
    print("[guide/content.ts] patched.")

# ---------------------------------------------------------------------------
# 4. tests/integration/important-dates.test.ts
# ---------------------------------------------------------------------------

TEST_OLD = '''describe("important-dates-job: idempotency (spec: never create the same holiday/reminder/task twice)", () => {
  it("seedHolidayOccurrences() run twice never creates duplicate ImportantDate rows for the same client+holiday", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const client = await createTestClient();
    await setHolidayCalendarSubscription(superAdmin, client.id, "il_holidays", { enabled: true, responsibleUserId: superAdmin.id });

    const first = await seedHolidayOccurrences(new Date("2026-01-01T00:00:00Z"));
    expect(first.created).toBeGreaterThan(0);

    const second = await seedHolidayOccurrences(new Date("2026-01-01T00:00:00Z"));
    expect(second.created).toBe(0); // every holiday already exists - the @@unique([clientId, holidayKey]) constraint is what actually guarantees this

    const rows = await prisma.importantDate.findMany({ where: { clientId: client.id, source: "HOLIDAY" } });
    const keys = rows.map((r) => r.holidayKey);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate holidayKey per client
  });'''

TEST_NEW = '''describe("important-dates-job: idempotency (spec: never create the same holiday/reminder/task twice)", () => {
  it("subscribing seeds holidays immediately (no need to wait for the daily cron), and a subsequent sweep never creates duplicates", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const client = await createTestClient();

    // setHolidayCalendarSubscription() itself seeds immediately now
    // (Ariel follow-up request) - no explicit seedHolidayOccurrences()
    // call needed here to see the rows show up.
    await setHolidayCalendarSubscription(superAdmin, client.id, "il_holidays", { enabled: true, responsibleUserId: superAdmin.id });

    const rowsAfterSubscribe = await prisma.importantDate.findMany({ where: { clientId: client.id, source: "HOLIDAY" } });
    expect(rowsAfterSubscribe.length).toBeGreaterThan(0);

    // A subsequent sweep (the daily cron's own unscoped call) must never
    // create duplicates - the @@unique([clientId, holidayKey]) constraint
    // is what actually guarantees this, not the scoping itself.
    const rerun = await seedHolidayOccurrences(new Date());
    expect(rerun.created).toBe(0);

    const rows = await prisma.importantDate.findMany({ where: { clientId: client.id, source: "HOLIDAY" } });
    const keys = rows.map((r) => r.holidayKey);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate holidayKey per client
  });

  it("seedHolidayOccurrences() scoped to one clientId+calendarKey never touches another client's subscription", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const clientA = await createTestClient();
    const clientB = await createTestClient();

    // Bypass the immediate-seed side effect of setHolidayCalendarSubscription()
    // here by inserting the subscription rows directly, so this test
    // isolates seedHolidayOccurrences()'s own scoping logic.
    await prisma.holidayCalendarSubscription.createMany({
      data: [
        { clientId: clientA.id, calendarKey: "il_holidays", enabled: true, defaultReminderDaysBefore: [30, 7], responsibleUserId: superAdmin.id, createTasks: false },
        { clientId: clientB.id, calendarKey: "il_holidays", enabled: true, defaultReminderDaysBefore: [30, 7], responsibleUserId: superAdmin.id, createTasks: false },
      ],
    });

    const result = await seedHolidayOccurrences(new Date(), { clientId: clientA.id, calendarKey: "il_holidays" });
    expect(result.created).toBeGreaterThan(0);

    const clientARows = await prisma.importantDate.findMany({ where: { clientId: clientA.id, source: "HOLIDAY" } });
    const clientBRows = await prisma.importantDate.findMany({ where: { clientId: clientB.id, source: "HOLIDAY" } });
    expect(clientARows.length).toBeGreaterThan(0);
    expect(clientBRows).toHaveLength(0); // scoped call must never seed an unrelated client
  });'''

patch_file(
    "tests/integration/important-dates.test.ts",
    "never touches another client's subscription",
    TEST_OLD,
    TEST_NEW,
    "tests/integration/important-dates.test.ts",
)

print("\nAll patches applied.")
print("Next:")
print("  git diff")
print("  git add -A")
print('  git commit -m "feat: seed subscribed holidays immediately instead of waiting for the daily cron"')
print("  git push -u origin feat/instant-holiday-seed")
print("\nThen open a PR (do not merge yet) - same review flow as every other change.")
