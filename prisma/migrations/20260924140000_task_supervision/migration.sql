-- Tasks phase 2: a second person on a task, and a signature.
--
-- `supervisorId` is who the work goes back to. It is NOT a second
-- assignee: the assignee does the work. Nullable, because most work needs
-- no second pair of eyes, and a required column here would be filled in
-- with whoever is at the top of the list.
--
-- `requiresApproval` is a separate switch from the supervisor on purpose.
-- Watching and signing off are two different jobs, and one column meaning
-- both would turn every watcher into a gate.
--
-- `approvedById` and `approvedAt` are written by the server on the move
-- out of PENDING_APPROVAL into DONE and cleared on reopen, exactly like
-- `completedAt`. Defaults leave every existing row correct with no
-- backfill: no supervisor, no approval required, never approved.

-- Added BEFORE 'DONE' because Postgres orders an enum by declaration and
-- the tasks list sorts on status. Work waiting for a signature belongs
-- beside work in progress, not after everything that is already finished.
--
-- Nothing else in this migration may reference the new value: Postgres
-- refuses to use an enum value added in the same transaction, and Prisma
-- runs each migration file as one.
ALTER TYPE "TaskStatus" ADD VALUE 'PENDING_APPROVAL' BEFORE 'DONE';

ALTER TABLE "tasks" ADD COLUMN "supervisorId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "tasks" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- SET NULL rather than CASCADE on both: a person leaving Ankora must not
-- delete the tasks they supervised, and must not erase the record that
-- somebody approved this work. The row keeps its history with the name
-- detached, which is what the audit log is for.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_supervisorId_fkey"
  FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The supervision screen reads one person's tasks with the waiting ones
-- first. Two columns, one index.
CREATE INDEX "tasks_supervisorId_status_idx" ON "tasks"("supervisorId", "status");
