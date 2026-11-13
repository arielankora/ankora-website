-- 13.11.2026 (processes redesign, stage 1; ops-runbooks/processes-redesign-
-- spec-2026-11-13.md in claude-backup, 4.1 to 4.3): what starts a process,
-- one row per start, and the dates generated for a start. The values added
-- to existing enums are used by the backfill in the next migration, after
-- this one commits.

CREATE TYPE "ProcessStartKind" AS ENUM ('SCHEDULE', 'EVENT', 'ON_DEMAND', 'CONTINUOUS', 'EXTERNAL');

ALTER TYPE "ProcessTrigger" ADD VALUE 'EXTERNAL';

ALTER TYPE "RecurrenceType" ADD VALUE 'DAILY';

ALTER TABLE "processes" ADD COLUMN "triggerNotes" TEXT;

ALTER TABLE "important_dates" ADD COLUMN "processStartId" TEXT;

CREATE TABLE "process_starts" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "ProcessStartKind" NOT NULL,
    "schedule" JSONB,
    "description" TEXT,
    "checkEveryDays" INTEGER,
    "checkText" TEXT,
    "externalWhere" TEXT,
    "externalWhen" TEXT,
    "externalRecipient" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_starts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "process_starts_processId_idx" ON "process_starts"("processId");

ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_processStartId_fkey" FOREIGN KEY ("processStartId") REFERENCES "process_starts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_starts" ADD CONSTRAINT "process_starts_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
