-- Tasks phase 1: the three things a task could not say about itself.
--
-- `description` is the first free-text field on a task beyond its one-line
-- title. Everything a colleague needs to pick the work up - an address, a
-- reference number, what was already tried - has been living in WhatsApp
-- because the model had nowhere to put it.
--
-- `priority` is defaulted, so every existing row is correctly NORMAL and
-- no backfill is needed. NOT NULL for the same reason: a nullable
-- priority would mean two ways to say "ordinary" and every read would
-- have to collapse them.
--
-- `startedAt` is the counterpart to `completedAt`, which the team-adoption
-- migration added on its own. Cycle time needs both ends. Set by the
-- server on the first move into IN_PROGRESS and never moved again, so a
-- task that bounces between statuses keeps the moment work began.
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

ALTER TABLE "tasks" ADD COLUMN "description" TEXT;
ALTER TABLE "tasks" ADD COLUMN "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "tasks" ADD COLUMN "startedAt" TIMESTAMP(3);

-- The Tasks screen orders urgent work first within a status band, then by
-- deadline. Three columns, one index, no per-client leg: the screen is
-- already scoped to the clients a person can reach before it sorts.
CREATE INDEX "tasks_status_priority_dueDate_idx" ON "tasks"("status", "priority", "dueDate");
