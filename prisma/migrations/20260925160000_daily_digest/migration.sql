-- The morning digest: one preference, and the memory of the last send.
--
-- Default true on the preference matches the existing notification
-- preference beside it: an account that has never chosen gets the
-- behaviour, and turning it off is a decision somebody makes.
--
-- `dailyDigestAt` starts null on purpose. The first digest for each
-- person then falls back to "since yesterday morning" rather than
-- reporting every task ever assigned to them as new.
ALTER TABLE "users" ADD COLUMN "dailyDigestByEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "dailyDigestAt" TIMESTAMP(3);
