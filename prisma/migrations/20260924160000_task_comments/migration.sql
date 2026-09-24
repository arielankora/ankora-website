-- Tasks phase 3: the conversation around a task.
--
-- Everything a colleague needed to know that was not a field lived in
-- WhatsApp. A task picked up two weeks later carried its title and
-- nothing else.
--
-- No clientVisible column, on purpose: the client-facing sentence is
-- tasks.clientOutcome, which already exists and already gates closing a
-- promise. A second client-facing channel is two places to write to a
-- client and two places to check, which is how one of them stops being
-- read.
--
-- authorId is nullable and SET NULL on delete, like every actor column
-- here: a person who leaves should not take their words out of the
-- thread with them.
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- The thread reads one task's comments in time order, and nothing else.
CREATE INDEX "task_comments_taskId_createdAt_idx" ON "task_comments"("taskId", "createdAt");

-- CASCADE from the task: tasks are soft-deleted in this product, so a
-- hard delete only ever happens if a row is removed outright, and then
-- its comments have nothing left to belong to.
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
