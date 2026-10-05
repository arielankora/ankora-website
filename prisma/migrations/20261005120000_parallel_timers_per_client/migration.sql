-- Parallel timers on different clients (Ariel, 5.10.2026)
-- ----------------------------------------------------------------------
-- Until now a person could run one timer. From here they can run up to
-- two, never two on the same client. The rule that a database index CAN
-- hold is "one active timer per (user, client)", so the index moves from
-- userId alone to (userId, clientId), with the same predicate as
-- 20260924120000: running and not deleted.
--
-- The cap of two per person is not an index. startTimer and reopenTimer
-- enforce it inside a transaction under pg_advisory_xact_lock keyed on
-- the user (lib/app-domain/time-entries.ts).
--
-- Order: create the new index first, then drop the old one. Every row
-- the old index allowed (at most one active per user) also satisfies the
-- new one, so the CREATE cannot fail on existing data, and there is no
-- moment without a constraint.
--
-- Rollback note: going back to the old index fails while any user has
-- two active timers. Close the newer one first:
--   UPDATE time_entries t SET "endAt" = now(),
--     "actualSeconds" = EXTRACT(EPOCH FROM now() - t."startAt")::int,
--     "billableSeconds" = EXTRACT(EPOCH FROM now() - t."startAt")::int
--   WHERE t."endAt" IS NULL AND t."deletedAt" IS NULL AND EXISTS (
--     SELECT 1 FROM time_entries o WHERE o."userId" = t."userId"
--       AND o."endAt" IS NULL AND o."deletedAt" IS NULL AND o."startAt" < t."startAt");
-- (billableSeconds then ignores the client's billing policy; recompute
-- by editing the entry if that matters.)

CREATE UNIQUE INDEX "time_entries_one_active_per_user_client"
  ON "time_entries"("userId", "clientId")
  WHERE "endAt" IS NULL AND "deletedAt" IS NULL;

DROP INDEX IF EXISTS "time_entries_one_active_per_user";
