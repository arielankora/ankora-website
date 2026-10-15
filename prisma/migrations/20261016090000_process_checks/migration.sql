-- 16.10.2026: the check of an ongoing process (org-brain spec 3.8). Three
-- nullable columns on processes, one enum, one table.
ALTER TABLE "processes" ADD COLUMN "checkEveryDays" INTEGER;
ALTER TABLE "processes" ADD COLUMN "checkText" TEXT;
ALTER TABLE "processes" ADD COLUMN "lastCheckedAt" TIMESTAMP(3);

CREATE TYPE "ProcessCheckOutcome" AS ENUM ('OK', 'ISSUE');

CREATE TABLE "process_checks" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "checkedById" TEXT,
    "outcome" "ProcessCheckOutcome" NOT NULL,
    "note" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "process_checks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "process_checks_processId_createdAt_idx" ON "process_checks"("processId", "createdAt");
ALTER TABLE "process_checks" ADD CONSTRAINT "process_checks_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
