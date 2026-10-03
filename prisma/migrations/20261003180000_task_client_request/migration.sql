-- What we ask the client to do, shown to them under "מחכה לך".
-- A new nullable column: no backfill, and nothing reads blockedReason
-- for the client, by design.
ALTER TABLE "tasks" ADD COLUMN "clientRequest" TEXT;
