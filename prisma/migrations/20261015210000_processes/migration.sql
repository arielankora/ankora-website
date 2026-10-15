-- 15.10.2026: processes and their procedures (org-brain spec 3.8, 3.9),
-- and the date that starts a process (3.10). New tables, one new column.
CREATE TYPE "ProcessTrigger" AS ENUM ('SCHEDULED', 'EVENT', 'ON_DEMAND', 'CONTINUOUS');
CREATE TYPE "ProcessStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED');
CREATE TYPE "ProcessTransition" AS ENUM ('WITH_CLIENT', 'IN_HANDOVER', 'WITH_ANKORA', 'NOT_PLANNED');
CREATE TYPE "ProcessVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

CREATE TABLE "processes" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT,
    "triggerKinds" "ProcessTrigger"[] DEFAULT ARRAY[]::"ProcessTrigger"[],
    "triggerText" TEXT,
    "ownerId" TEXT,
    "backupOwnerId" TEXT,
    "slaText" TEXT,
    "slaBusinessDays" INTEGER,
    "externalPartyContactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "externalPartyText" TEXT,
    "requiredSystemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approverText" TEXT,
    "approverContactId" TEXT,
    "approvalPolicyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvalText" TEXT,
    "exceptionPlaybook" TEXT,
    "entityId" TEXT,
    "executorText" TEXT,
    "transitionStatus" "ProcessTransition" NOT NULL DEFAULT 'WITH_CLIENT',
    "status" "ProcessStatus" NOT NULL DEFAULT 'DRAFT',
    "categoryId" TEXT,
    "reviewEveryDays" INTEGER,
    "lastReviewedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "knowledgeStatus" "KnowledgeStatus" NOT NULL DEFAULT 'CONFIRMED',
    "fieldStatus" JSONB NOT NULL DEFAULT '{}',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "externalRefs" JSONB NOT NULL DEFAULT '[]',
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "toResolve" TEXT,
    "importance" "KnowledgeImportance" NOT NULL DEFAULT 'NORMAL',
    "audience" "KnowledgeAudience" NOT NULL DEFAULT 'ALL_STAFF',
    "audienceUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "doNotDisclose" TEXT,
    "sensitivity" "KnowledgeSensitivity" NOT NULL DEFAULT 'NORMAL',
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "processes_clientId_seq_key" ON "processes"("clientId", "seq");
CREATE UNIQUE INDEX "processes_clientId_code_key" ON "processes"("clientId", "code");
CREATE INDEX "processes_clientId_deletedAt_idx" ON "processes"("clientId", "deletedAt");
ALTER TABLE "processes" ADD CONSTRAINT "processes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "process_versions" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProcessVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "highlights" TEXT,
    "outputs" TEXT,
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    CONSTRAINT "process_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "process_versions_processId_version_key" ON "process_versions"("processId", "version");
ALTER TABLE "process_versions" ADD CONSTRAINT "process_versions_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "important_dates" ADD COLUMN "processId" TEXT;
ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
