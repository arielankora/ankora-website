-- Tasks phase 5: a task can be a step of another task.
--
-- One level only, which is a rule the application enforces rather than
-- the schema: Postgres has no way to say "a row whose parentId is set
-- may not itself be a parent" without a trigger, and a trigger here
-- would be a second place the rule lives. createTask refuses it, and a
-- test proves the refusal.
--
-- ON DELETE CASCADE, unlike every other foreign key on this table. A
-- step has no meaning without the task it is a step of. Deletes here are
-- soft (deletedAt), so this only ever fires if a row is truly removed.
ALTER TABLE "tasks" ADD COLUMN "parentId" TEXT;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Read on almost every task query: every screen that lists work asks
-- which of these rows are steps of something else.
CREATE INDEX "tasks_parentId_status_idx" ON "tasks"("parentId", "status");
