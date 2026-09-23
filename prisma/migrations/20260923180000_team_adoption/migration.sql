-- Team adoption: the two columns that make a closed promise mean something.
--
-- `clientOutcome` is the sentence the client reads when a promise is done.
-- `clientTitle` is what the thing was CALLED; this is what HAPPENED. The
-- portal's activity screen and the monthly summary have been assembling
-- themselves out of titles alone, which is why a finished promise reads
-- like an open one with a green pill on it.
--
-- `completedAt` is the real "when". The portal has been showing
-- `updatedAt` as the moment a promise moved, which moves again every time
-- anyone edits anything on the row - a client seeing "הושלם" against
-- today's date for work finished three weeks ago. Nullable and only ever
-- set on the transition into DONE.
ALTER TABLE "tasks" ADD COLUMN "clientOutcome" TEXT;
ALTER TABLE "tasks" ADD COLUMN "completedAt" TIMESTAMP(3);

-- The manager's metric: visible promises that have not moved today, and
-- the employee's home screen, which asks the same question about one
-- person's own rows. Both filter on status + clientVisible and sort on
-- the last movement, so the index carries all three.
CREATE INDEX "tasks_clientVisible_status_updatedAt_idx" ON "tasks"("clientVisible", "status", "updatedAt");
