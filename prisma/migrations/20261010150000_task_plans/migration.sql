-- "קדם עם קלוד" (10.10.2026): the work plan of a task, one row per version.
--
-- A new table rather than a column on tasks: a plan has versions, an
-- author, an approver and a set of proposed steps, and a single text
-- column would lose all four. The current plan is the highest version.
CREATE TYPE "TaskPlanStatus" AS ENUM ('DRAFT', 'APPROVED');

CREATE TABLE "task_plans" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "TaskPlanStatus" NOT NULL DEFAULT 'APPROVED',
    "origin" "EntryOrigin" NOT NULL DEFAULT 'APP',
    "changeNote" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "stepsAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_plans_pkey" PRIMARY KEY ("id")
);

-- One row per version per task. Also the guard against two saves that
-- both passed the version check at the same moment.
CREATE UNIQUE INDEX "task_plans_taskId_version_key" ON "task_plans"("taskId", "version");

ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
