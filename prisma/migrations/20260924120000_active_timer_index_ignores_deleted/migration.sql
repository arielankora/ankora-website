-- One active timer per user: the index has to agree with the code
-- ----------------------------------------------------------------------
-- Phase 2 created:
--
--   CREATE UNIQUE INDEX "time_entries_one_active_per_user"
--     ON "time_entries"("userId") WHERE "endAt" IS NULL;
--
-- The application's own definition of "active" (getActiveTimer in
-- lib/app-domain/time-entries.ts) is narrower: userId + endAt IS NULL +
-- deletedAt IS NULL. Deletes here are soft (spec 6.1) and deleteTimeEntry
-- never touched endAt, so "מחיקה ללא שמירה" on a RUNNING timer left a row
-- the app cannot see and the index still counts.
--
-- The result was a permanent, un-clearable block: the timer screen showed
-- "אין טיימר פעיל", every start failed the unique index, and startTimer
-- turned that 23505 into the friendly "כבר קיים טיימר פעיל. יש לעצור אותו
-- קודם." - with nothing to stop. Reported 24.9.2026, after the row had
-- been sitting there unnoticed.
--
-- Two statements, in this order: close the rows that already exist, then
-- narrow the index so no new one can be created. The narrower predicate
-- is still race-safe for concurrent starts (spec 18.2) - every freshly
-- inserted row has deletedAt NULL, so two simultaneous starts still
-- collide on it.

UPDATE "time_entries"
SET "endAt" = "startAt", "actualSeconds" = 0, "billableSeconds" = 0
WHERE "endAt" IS NULL AND "deletedAt" IS NOT NULL;

DROP INDEX IF EXISTS "time_entries_one_active_per_user";

CREATE UNIQUE INDEX "time_entries_one_active_per_user"
  ON "time_entries"("userId")
  WHERE "endAt" IS NULL AND "deletedAt" IS NULL;
