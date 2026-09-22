-- Portal phase 1: which tasks are promises the client can see, what they
-- are called in the client's words, and since when they are waiting on
-- the client. Additive only; every existing task stays invisible to the
-- portal until someone opts it in.
ALTER TABLE "tasks" ADD COLUMN "clientVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "clientTitle" TEXT;
ALTER TABLE "tasks" ADD COLUMN "waitingOnClientSince" TIMESTAMP(3);

-- The portal reads "the visible tasks of one client, newest movement
-- first" on every screen it has.
CREATE INDEX "tasks_clientId_clientVisible_idx" ON "tasks"("clientId", "clientVisible");
