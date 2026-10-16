-- 16.10.2026: when a person was last active, not only when they last
-- signed in. Backfilled from lastLoginAt, the best value there is.
ALTER TABLE "users" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
UPDATE "users" SET "lastSeenAt" = "lastLoginAt";
