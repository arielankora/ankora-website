-- 15.10.2026: a run of a process is a task (org-brain spec 3.12). Three
-- nullable columns on tasks, one enum, one index.
CREATE TYPE "ProcessStepMode" AS ENUM ('MANUAL', 'ASSISTED', 'AUTOMATED');
ALTER TABLE "tasks" ADD COLUMN "processId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "processVersionId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "stepMode" "ProcessStepMode";
CREATE INDEX "tasks_processId_idx" ON "tasks"("processId");
